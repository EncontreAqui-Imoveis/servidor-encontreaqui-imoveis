import { Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { getNegotiationDbConnection } from './negotiationPersistenceService';
import {
  assertProposalValidityDateNotPast,
  buildProposalValidityDate,
  normalizeOptionalPositiveId,
  normalizeProposalCpfKey,
  parseProposalWizardBody,
  type ParsedProposalWizard,
  type ProposalWizardBody,
} from './negotiationProposalSupportService';
import { isValidCpf, normalizeCpfDigits } from '../utils/cpfValidator';

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

interface UserRow extends RowDataPacket {
  name: string;
  cpf?: string | null;
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
  if (normalizedRole === 'admin') {
    return true;
  }
  if (normalizedRole === 'client') {
    return (
      userId === Number(negotiation.buyer_client_id ?? 0) ||
      userId === Number(negotiation.seller_client_id ?? 0)
    );
  }
  if (normalizedRole === 'broker' || normalizedRole === 'auxiliary_administrative') {
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

function normalizeComparableText(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isOwnerSelfProposalAttempt(
  ownerUserId: number,
  currentUser: { name?: string | null; cpf?: string | null } | null,
  payload: ParsedProposalWizard
): boolean {
  if (Number(ownerUserId) <= 0) {
    return false;
  }

  const currentCpf = normalizeCpfDigits(String(currentUser?.cpf ?? ''));
  const payloadCpf = normalizeCpfDigits(payload.clientCpf);
  if (currentCpf.length === 11 && payloadCpf.length === 11 && currentCpf === payloadCpf) {
    return true;
  }

  const currentName = normalizeComparableText(String(currentUser?.name ?? ''));
  const payloadName = normalizeComparableText(payload.clientName);
  return currentName.length > 0 && currentName === payloadName;
}

async function resolveCurrentUserIdentity(
  tx: PoolConnection,
  userId: number
): Promise<{ name: string | null; cpf: string | null }> {
  const [rows] = await tx.query<UserRow[]>(
    'SELECT name, cpf FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  return {
    name: rows[0]?.name ?? null,
    cpf: rows[0]?.cpf ?? null,
  };
}

function isBrokerLikeRole(role: unknown): boolean {
  const normalized = String(role ?? '').trim().toLowerCase();
  return normalized === 'broker' || normalized === 'auxiliary_administrative';
}

async function negotiationHasSignedProposalDocument(
  tx: PoolConnection,
  negotiationId: string
): Promise<boolean> {
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
  return Number(signedDocRows[0]?.c ?? 0) > 0;
}

export async function updateProposalFromWizard(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  return updateProposalFromWizardInternal(req, res, false);
}

export async function updateProposalFromWizardAsAdmin(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  return updateProposalFromWizardInternal(req, res, true);
}

async function updateProposalFromWizardInternal(
  req: AuthRequest,
  res: Response,
  allowAdmin: boolean
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
          n.final_value,
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
          final_value: number | string | null;
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

    const roleForAccess = String(req.userRole ?? '').trim().toLowerCase();
    if (
      !(allowAdmin && roleForAccess === 'admin') &&
      !canManageOwnProposal(Number(req.userId), roleForAccess, {
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

    if (await negotiationHasSignedProposalDocument(tx, negotiationId)) {
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

    const userRole = roleForAccess;
    const isClientUser = userRole === 'client';
    const isBrokerUser = isBrokerLikeRole(userRole);
    const isAdminUser = userRole === 'admin';
    const isAdminAuthorized = allowAdmin && isAdminUser;
    if (!allowAdmin) {
      if (!isClientUser && !isBrokerUser) {
        await tx.rollback();
        return res.status(403).json({ error: 'Apenas clientes, corretores ou assistentes podem editar proposta.' });
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

    const body = req.body as ProposalWizardBody;
    const rawDeclared =
      body.proposalValue ?? body.valorProposta ?? (req.body as { proposal_value?: unknown }).proposal_value;
    let proposalValue = Number(nRow.final_value ?? property.price ?? 0);
    if (!Number.isFinite(proposalValue) || proposalValue <= 0) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Imovel sem valor valido para editar proposta.',
        'PROPOSAL_VALIDATION_FAILED'
      );
    }
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
    const requestedCapturingBrokerId = isClientUser || isAdminUser
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

    if (Number(property.owner_id ?? 0) === Number(req.userId ?? 0)) {
      const currentUser = await resolveCurrentUserIdentity(tx, Number(req.userId));
      if (isOwnerSelfProposalAttempt(Number(req.userId), currentUser, payload)) {
        await tx.rollback();
        return sendProposalError(
          res,
          403,
          'O proponente não pode ser o próprio dono do imóvel.',
          'FORBIDDEN'
        );
      }
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

    const listingValue = Number(property.price ?? proposalValue ?? 0);
    const safeListingValue = Number.isFinite(listingValue) && listingValue > 0 ? listingValue : proposalValue;

    const paymentDetails = JSON.stringify({
      method: 'OTHER',
      validadeDias: payload.validadeDias,
      amount: Number(proposalValue.toFixed(2)),
      details: {
        ...payload.pagamento,
        clientName: payload.clientName,
        clientCpf: payload.clientCpf,
        listingValue: Number(safeListingValue.toFixed(2)),
      },
    });
    let proposalValidityDate = String(buildProposalValidityDate(payload.validadeDias) ?? '').trim();
    if (!proposalValidityDate) {
      const fallbackDate = new Date();
      fallbackDate.setDate(fallbackDate.getDate() + payload.validadeDias);
      const yyyy = fallbackDate.getFullYear().toString().padStart(4, '0');
      const mm = String(fallbackDate.getMonth() + 1).padStart(2, '0');
      const dd = String(fallbackDate.getDate()).padStart(2, '0');
      proposalValidityDate = `${yyyy}-${mm}-${dd}`;
    }
    assertProposalValidityDateNotPast(proposalValidityDate);

    const fromStatus = String(nRow.status ?? 'PROPOSAL_DRAFT').trim().toUpperCase();
    await tx.execute(
      `
        UPDATE negotiations
        SET
          property_id = ?,
          client_name = ?,
          client_cpf = ?,
          status = ?,
          final_value = ?,
          payment_details = CAST(? AS JSON),
          proposal_validity_date = ?,
          last_draft_edit_at = CURRENT_TIMESTAMP,
          version = COALESCE(version, 0) + 1
        WHERE id = ?
      `,
      [
        payload.propertyId,
        payload.clientName,
        payload.clientCpf,
        DEFAULT_WIZARD_STATUS,
        proposalValue,
        paymentDetails,
        proposalValidityDate,
        negotiationId,
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
        negotiationId,
        fromStatus,
        DEFAULT_WIZARD_STATUS,
        allowAdmin && roleForAccess === 'admin' ? null : req.userId,
        JSON.stringify({
          source: 'mobile_proposal_wizard_update',
          payment: payload.pagamento,
          sellerBrokerId: normalizeOptionalPositiveId(req.userId),
          sellerClientId,
          capturingBrokerId: normalizeOptionalPositiveId(req.userId),
          buyerClientId,
          clientName: payload.clientName,
          clientCpf: payload.clientCpf,
          adminId: allowAdmin && roleForAccess === 'admin' ? req.userId : null,
        }),
      ]
    );
    await tx.commit();

    return res.status(200).json({
      negotiationId,
      propertyId: payload.propertyId,
      clientName: payload.clientName,
      clientCpf: payload.clientCpf,
      validityDays: payload.validadeDias,
      value: Number(proposalValue.toFixed(2)),
      payment: {
        dinheiro: payload.pagamento.dinheiro,
        permuta: payload.pagamento.permuta,
        financiamento: payload.pagamento.financiamento,
        outros: payload.pagamento.outros,
      },
      status: DEFAULT_WIZARD_STATUS,
    });
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
