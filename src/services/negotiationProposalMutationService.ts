import { randomUUID } from 'crypto';
import { Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { getNegotiationDbConnection, generateNegotiationProposalPdf, saveNegotiationProposalDocument } from './negotiationPersistenceService';
import {
  assertProposalValidityDateNotPast,
  buildProposalValidityDate,
  normalizeOptionalPositiveId,
  normalizeProposalCpfKey,
  parseProposalWizardBody,
  resolvePropertyAddress,
  resolvePropertyValue,
  toCents,
  type ParsedProposalWizard,
  type ProposalWizardBody,
} from './negotiationProposalSupportService';
import { isValidCpf } from '../utils/cpfValidator';

interface NegotiationAccessRow extends RowDataPacket {
  id: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  seller_client_id: number | null;
  buyer_client_id: number | null;
  status?: string | null;
}

interface PropertyRow extends RowDataPacket {
  id: number;
  broker_id: number | null;
  owner_id: number | null;
  status: string | null;
  address: string | null;
  numero: string | null;
  quadra: string | null;
  lote: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  price_sale: number | null;
  price_rent: number | null;
}

const PRE_SIGNED_PROPOSAL_EDIT_STATUSES = new Set([
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'AWAITING_SIGNATURES',
]);

const DEFAULT_WIZARD_STATUS = 'PROPOSAL_SENT';
const PROPOSAL_EDIT_COOLDOWN_MS = 30_000;

function sendProposalError(
  res: Response,
  statusCode: number,
  error: string,
  code: string,
  payload?: Record<string, unknown>
): Response {
  return res.status(statusCode).json({
    error,
    code,
    ...(payload ?? {}),
  });
}

function canAccessNegotiationByOwnership(
  userId: number,
  negotiation: NegotiationAccessRow
): boolean {
  return (
    userId === Number(negotiation.capturing_broker_id ?? 0) ||
    userId === Number(negotiation.selling_broker_id ?? 0) ||
    userId === Number(negotiation.seller_client_id ?? 0) ||
    userId === Number(negotiation.buyer_client_id ?? 0)
  );
}

function canManageOwnProposal(
  userId: number,
  role: string,
  negotiation: NegotiationAccessRow
): boolean {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  if (normalizedRole === 'client') {
    return (
      userId === Number(negotiation.buyer_client_id ?? 0) ||
      userId === Number(negotiation.seller_client_id ?? 0)
    );
  }
  if (normalizedRole === 'broker') {
    return userId === Number(negotiation.capturing_broker_id ?? 0);
  }
  return canAccessNegotiationByOwnership(userId, negotiation);
}

function isDependencyUnavailableError(error: unknown): boolean {
  const anyError = error as {
    isAxiosError?: boolean;
    code?: string | null;
    message?: string | null;
  };

  const code = String(anyError?.code ?? '').toUpperCase();
  const message = String(anyError?.message ?? '').toUpperCase();

  if (message.includes('PDF_INTERNAL_API_KEY')) {
    return true;
  }

  if (anyError?.isAxiosError) {
    return code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET';
  }

  return code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET';
}

export async function updateProposalFromWizard(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return sendProposalError(res, 401, 'Usuário não autenticado.', 'SESSION_EXPIRED');
  }

  const negotiationId = String(req.params.id ?? '').trim();
  if (!negotiationId) {
    return sendProposalError(res, 400, 'ID de negociação inválido.', 'PROPOSAL_VALIDATION_FAILED');
  }

  let payload: ParsedProposalWizard;
  try {
    payload = parseProposalWizardBody((req.body ?? {}) as ProposalWizardBody);
  } catch (error) {
    return sendProposalError(
      res,
      400,
      (error as Error).message,
      'PROPOSAL_VALIDATION_FAILED'
    );
  }

  let tx: PoolConnection | null = null;
  try {
    tx = await getNegotiationDbConnection();
    await tx.beginTransaction();

    const [negotiationLockRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT
          n.id,
          n.property_id,
          n.status,
          n.capturing_broker_id,
          n.selling_broker_id,
          n.buyer_client_id,
          n.last_draft_edit_at
        FROM negotiations n
        WHERE n.id = ?
        FOR UPDATE
      `,
      [negotiationId]
    );
    const nRow = negotiationLockRows[0] as
      | {
          id: string;
          property_id: number;
          status: string;
          capturing_broker_id: number | null;
          selling_broker_id: number | null;
          buyer_client_id: number | null;
          last_draft_edit_at: Date | string | null;
        }
      | undefined;

    if (!nRow) {
      await tx.rollback();
      return sendProposalError(res, 404, 'Negociação não encontrada.', 'NOT_FOUND');
    }

    if (
      !canManageOwnProposal(Number(req.userId), String(req.userRole ?? ''), {
        id: nRow.id,
        capturing_broker_id: nRow.capturing_broker_id,
        selling_broker_id: nRow.selling_broker_id,
        buyer_client_id: nRow.buyer_client_id,
      } as NegotiationAccessRow)
    ) {
      await tx.rollback();
      return sendProposalError(res, 403, 'Acesso negado a esta proposta.', 'FORBIDDEN');
    }

    const st = String(nRow.status ?? '').trim().toUpperCase();
    if (!PRE_SIGNED_PROPOSAL_EDIT_STATUSES.has(st)) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Esta proposta não pode ser editada após o envio da minuta assinada.',
        'PROPOSAL_LOCKED'
      );
    }

    const [signedDocRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT COUNT(*) AS c
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND type = 'other'
          AND document_type = 'contrato_assinado'
      `,
      [negotiationId]
    );
    if (Number(signedDocRows[0]?.c ?? 0) > 0) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Esta proposta não pode ser editada após o envio da minuta assinada.',
        'PROPOSAL_LOCKED'
      );
    }

    if (Number(nRow.property_id) !== Number(payload.propertyId)) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'O imovel nao confere com a negociacao.',
        'PROPOSAL_VALIDATION_FAILED'
      );
    }

    if (nRow.last_draft_edit_at) {
      const lastAt = new Date(nRow.last_draft_edit_at as string | Date).getTime();
      if (Number.isFinite(lastAt)) {
        const elapsed = Date.now() - lastAt;
        if (elapsed < PROPOSAL_EDIT_COOLDOWN_MS) {
          const rest = Math.max(1, Math.ceil((PROPOSAL_EDIT_COOLDOWN_MS - elapsed) / 1000));
          await tx.rollback();
          return sendProposalError(
            res,
            409,
            `Aguarde ${rest} segundo(s) para editar novamente esta proposta.`,
            'PROPOSAL_EDIT_COOLDOWN',
            { secondsUntilNextEdit: rest }
          );
        }
      }
    }

    const [propertyRows] = await tx.query<PropertyRow[]>(
      `
        SELECT
          id,
          broker_id,
          owner_id,
          status,
          address,
          numero,
          quadra,
          lote,
          bairro,
          city,
          state,
          price,
          price_sale,
          price_rent
        FROM properties
        WHERE id = ?
        FOR UPDATE
      `,
      [payload.propertyId]
    );
    const property = propertyRows[0];
    if (!property) {
      await tx.rollback();
      return sendProposalError(res, 404, 'Imóvel não encontrado.', 'NOT_FOUND');
    }

    const userRole = String(req.userRole ?? '').trim().toLowerCase();
    const isClientUser = userRole === 'client';
    const isBrokerUser = userRole === 'broker';
    if (!isClientUser && !isBrokerUser) {
      await tx.rollback();
      return res.status(403).json({ error: 'Apenas clientes ou corretores podem editar proposta.' });
    }
    if (!isBrokerUser) {
      if (Number(property.owner_id ?? 0) === Number(req.userId ?? 0)) {
        await tx.rollback();
        return sendProposalError(
          res,
          403,
          'Nao e possivel editar proposta do proprio anuncio.',
          'FORBIDDEN'
        );
      }
    }
    if (String(property.status ?? '').trim().toLowerCase() !== 'approved') {
      await tx.rollback();
      return sendProposalError(
        res,
        409,
        'A proposta só pode ser gerada para imóveis aprovados.',
        'CONFLICT'
      );
    }

    const listingValue = resolvePropertyValue(property);
    if (listingValue <= 0) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Imovel sem valor valido para gerar proposta.',
        'PROPOSAL_VALIDATION_FAILED'
      );
    }
    const body = req.body as ProposalWizardBody;
    const rawDeclared =
      body.proposalValue ?? body.valorProposta ?? (req.body as { proposal_value?: unknown }).proposal_value;
    let proposalValue = listingValue;
    if (rawDeclared !== undefined && rawDeclared !== null && String(rawDeclared).trim() !== '') {
      const parsedDeclared = Number(rawDeclared);
      if (!Number.isFinite(parsedDeclared) || parsedDeclared <= 0) {
        await tx.rollback();
        return sendProposalError(
          res,
          400,
          'proposalValue invalido.',
          'PROPOSAL_VALIDATION_FAILED'
        );
      }
      proposalValue = Number(parsedDeclared.toFixed(2));
    }
    const paymentTotal =
      payload.pagamento.dinheiro +
      payload.pagamento.permuta +
      payload.pagamento.financiamento +
      payload.pagamento.outros;
    if (toCents(paymentTotal) !== toCents(proposalValue)) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'A soma dos pagamentos deve ser exatamente igual ao valor total informado na proposta.',
        'PROPOSAL_VALIDATION_FAILED',
        { propertyValue: proposalValue, paymentTotal }
      );
    }
    const requestedCapturingBrokerId = isClientUser
      ? normalizeOptionalPositiveId(property.broker_id)
      : normalizeOptionalPositiveId(req.userId);
    if (isBrokerUser && requestedCapturingBrokerId === null) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Corretor captador invalido para esta proposta.',
        'PROPOSAL_VALIDATION_FAILED'
      );
    }
    if (normalizeOptionalPositiveId(nRow.capturing_broker_id) !== requestedCapturingBrokerId) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Corretor captador incompativel com a negociacao existente.',
        'CONFLICT'
      );
    }

    const cpfKey = normalizeProposalCpfKey(payload.clientCpf);
    if (!isValidCpf(cpfKey)) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'CPF do cliente invalido na proposta.',
        'PROPOSAL_VALIDATION_FAILED'
      );
    }

    const buyerClientId: number | null = isClientUser ? Number(req.userId) : null;
    const sellerClientId: number | null = normalizeOptionalPositiveId(property.owner_id);

    const normalizedCpfExpr = `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(client_cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '')`;

    const [existingRows] = await tx.query<NegotiationAccessRow[]>(
      `
        SELECT id, status
        FROM negotiations
        WHERE property_id = ?
          AND id <> ?
          AND status IN ('PROPOSAL_DRAFT', 'PROPOSAL_SENT', 'IN_NEGOTIATION', 'DOCUMENTATION_PHASE', 'CONTRACT_DRAFTING', 'AWAITING_SIGNATURES')
          AND (
            (buyer_client_id IS NOT NULL AND buyer_client_id = ?)
            OR (
              buyer_client_id IS NULL
              AND ${normalizedCpfExpr} = ?
            )
          )
        LIMIT 1
        FOR UPDATE
      `,
      [payload.propertyId, negotiationId, buyerClientId, cpfKey]
    );
    if (existingRows.length > 0) {
      await tx.rollback();
      return sendProposalError(
        res,
        409,
        'Ja existe uma proposta ativa desta pessoa para este imovel.',
        'PROPOSAL_ALREADY_EXISTS'
      );
    }

    const paymentDetails = JSON.stringify({
      method: 'OTHER',
      validadeDias: payload.validadeDias,
      amount: Number(proposalValue.toFixed(2)),
      details: {
        ...payload.pagamento,
        clientName: payload.clientName,
        clientCpf: payload.clientCpf,
        listingValue: Number(listingValue.toFixed(2)),
      },
    });
    const proposalValidityDate = buildProposalValidityDate(payload.validadeDias);
    assertProposalValidityDateNotPast(proposalValidityDate);

    const negotiationUuid = randomUUID();
    const fromStatus = 'PROPOSAL_DRAFT';
    await tx.execute(
      `
        INSERT INTO negotiations (
          id,
          property_id,
          capturing_broker_id,
          selling_broker_id,
          seller_client_id,
          buyer_client_id,
          client_name,
          client_cpf,
          status,
          final_value,
          payment_details,
          proposal_validity_date,
          created_at,
          version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, CURRENT_TIMESTAMP, 0)
      `,
      [
        negotiationUuid,
        payload.propertyId,
        normalizeOptionalPositiveId(req.userId),
        normalizeOptionalPositiveId(req.userId),
        sellerClientId,
        buyerClientId,
        payload.clientName,
        payload.clientCpf,
        DEFAULT_WIZARD_STATUS,
        proposalValue,
        paymentDetails,
        proposalValidityDate,
      ]
    );

    await tx.execute(
      `
        INSERT INTO negotiation_history (
          id,
          negotiation_id,
          from_status,
          to_status,
          actor_id,
          metadata_json,
          created_at
        ) VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
      `,
      [
        negotiationUuid,
        fromStatus,
        DEFAULT_WIZARD_STATUS,
        req.userId,
        JSON.stringify({
          source: 'mobile_proposal_wizard_update',
          payment: payload.pagamento,
          sellerBrokerId: normalizeOptionalPositiveId(req.userId),
          sellerClientId,
          capturingBrokerId: normalizeOptionalPositiveId(req.userId),
          buyerClientId,
          clientName: payload.clientName,
          clientCpf: payload.clientCpf,
        }),
      ]
    );

    const proposalData = {
      clientName: payload.clientName,
      clientCpf: payload.clientCpf,
      propertyAddress: resolvePropertyAddress(property),
      brokerName: String(req.userId),
      sellingBrokerName: String(req.userId),
      value: proposalValue,
      payment: {
        cash: payload.pagamento.dinheiro,
        tradeIn: payload.pagamento.permuta,
        financing: payload.pagamento.financiamento,
        others: payload.pagamento.outros,
      },
      validityDays: payload.validadeDias,
    };

    const pdfBuffer = await generateNegotiationProposalPdf(proposalData);
    const documentId = await saveNegotiationProposalDocument(negotiationUuid, pdfBuffer, tx, {
      originalFileName: 'proposta.pdf',
      generated: true,
    });
    void documentId;
    await tx.commit();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="proposal_${negotiationUuid}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    res.setHeader('X-Negotiation-Id', negotiationUuid);
    return res.status(201).send(pdfBuffer);
  } catch (error) {
    if (tx) {
      await tx.rollback();
    }
    console.error('Erro ao editar proposta (wizard):', error);
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes('proposal_validity_date')
    ) {
      return sendProposalError(res, 400, error.message, 'PROPOSAL_VALIDATION_FAILED');
    }
    if (isDependencyUnavailableError(error)) {
      return sendProposalError(
        res,
        503,
        'Serviço temporariamente indisponivel. Tente novamente em instantes.',
        'DEPENDENCY_UNAVAILABLE',
        { retryable: true }
      );
    }
    return sendProposalError(
      res,
      500,
      'Falha ao salvar a proposta editada.',
      'INTERNAL_SERVER_ERROR'
    );
  } finally {
    tx?.release();
  }
}

export async function deleteMyProposal(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const negotiationId = String(req.params.id ?? '').trim();
  if (!negotiationId) {
    return res.status(400).json({ error: 'ID de negociação inválido.' });
  }

  const userId = Number(req.userId);
  let tx: PoolConnection | null = null;
  try {
    tx = await getNegotiationDbConnection();
    await tx.beginTransaction();
    const [rows] = await tx.query<NegotiationAccessRow[]>(
      'SELECT id, capturing_broker_id, selling_broker_id, seller_client_id, buyer_client_id, status FROM negotiations WHERE id = ? FOR UPDATE',
      [negotiationId]
    );
    const row = rows[0];
    if (!row) {
      await tx.rollback();
      return res.status(404).json({ error: 'Negociação não encontrada.' });
    }
    if (!canManageOwnProposal(userId, String(req.userRole ?? ''), row)) {
      await tx.rollback();
      return res.status(403).json({ error: 'Acesso negado a esta proposta.' });
    }
    const st = String(row.status ?? '')
      .trim()
      .toUpperCase();
    if (!PRE_SIGNED_PROPOSAL_EDIT_STATUSES.has(st)) {
      await tx.rollback();
      return res.status(400).json({
        error: 'Não é possível excluir a proposta após o envio da minuta assinada.',
      });
    }
    const [signedDocRows] = await tx.query<RowDataPacket[]>(
      `
        SELECT COUNT(*) AS c
        FROM negotiation_documents
        WHERE negotiation_id = ?
          AND type = 'other'
          AND document_type = 'contrato_assinado'
      `,
      [negotiationId]
    );
    if (Number(signedDocRows[0]?.c ?? 0) > 0) {
      await tx.rollback();
      return res.status(400).json({
        error: 'Não é possível excluir a proposta após o envio da minuta assinada.',
      });
    }
    await tx.query('DELETE FROM negotiation_proposal_idempotency WHERE negotiation_id = ?', [
      negotiationId,
    ]);
    await tx.query('DELETE FROM negotiations WHERE id = ?', [negotiationId]);
    await tx.commit();
    return res.status(204).send();
  } catch (error) {
    if (tx) {
      await tx.rollback();
    }
    console.error('Erro ao excluir proposta:', error);
    return res.status(500).json({ error: 'Falha ao excluir proposta.' });
  } finally {
    tx?.release();
  }
}
