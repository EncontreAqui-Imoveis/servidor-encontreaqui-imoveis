import { randomUUID } from 'crypto';
import { Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import {
  findNegotiationDocumentById,
  generateNegotiationProposalPdf,
  getNegotiationDbConnection,
  saveNegotiationProposalDocument,
} from './negotiationPersistenceService';
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

interface NegotiationRow extends RowDataPacket {
  id: string;
  status: string;
}

interface ProposalIdempotencyRow extends RowDataPacket {
  id: number;
  negotiation_id: string | null;
  document_id: number | null;
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

interface BrokerRow extends RowDataPacket {
  name: string;
}

type BrokerProposalContext = {
  capturingBrokerId: number | null;
  sellerBrokerId: number | null;
  capturingBrokerName: string;
  sellingBrokerName: string | null;
};

const ACTIVE_NEGOTIATION_STATUSES = [
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
] as const;

const DEFAULT_WIZARD_STATUS = 'PROPOSAL_SENT';
const DUPLICATE_PROPOSAL_CONFLICT_MESSAGE =
  'Ja existe uma proposta ativa desta pessoa para este imovel.';

function resolveIdempotencyKey(req: AuthRequest): string {
  const fromHeader = String(req.get('Idempotency-Key') ?? '').trim();
  if (fromHeader.length > 0) {
    return fromHeader.slice(0, 128);
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = String(body.idempotency_key ?? body.idempotencyKey ?? '').trim();
  return fromBody.slice(0, 128);
}

function sendProposalError(
  req: AuthRequest,
  res: Response,
  statusCode: number,
  code: string,
  error: string,
  retryable: boolean,
  extras?: Record<string, unknown>
): Response {
  return res.status(statusCode).json({
    status: 'error',
    code,
    error,
    retryable,
    correlation_id: getRequestId(req),
    ...(extras ?? {}),
  });
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

async function resolveBrokerProposalContext(
  tx: PoolConnection,
  capturingBrokerId: number | null,
  requestedSellerBrokerId: number | null
): Promise<BrokerProposalContext> {
  const normalizedCapturingBrokerId = normalizeOptionalPositiveId(capturingBrokerId);

  if (normalizedCapturingBrokerId === null) {
    if (requestedSellerBrokerId !== null) {
      console.warn('Ignorando selling broker sem corretor captador em proposta.', {
        requestedSellerBrokerId,
      });
    }
    return {
      capturingBrokerId: null,
      sellerBrokerId: null,
      capturingBrokerName: 'Corretor a definir',
      sellingBrokerName: null,
    };
  }

  const [capturingRows] = await tx.query<BrokerRow[]>(
    'SELECT name FROM users WHERE id = ? LIMIT 1',
    [normalizedCapturingBrokerId]
  );
  const capturingBrokerName = String(capturingRows[0]?.name ?? '').trim();
  if (!capturingBrokerName) {
    throw new Error('Corretor captador inválido.');
  }

  if (
    requestedSellerBrokerId != null &&
    requestedSellerBrokerId !== normalizedCapturingBrokerId
  ) {
    console.warn('Ignorando selling broker legado em proposta.', {
      capturingBrokerId: normalizedCapturingBrokerId,
      requestedSellerBrokerId,
    });
  }

  return {
    capturingBrokerId: normalizedCapturingBrokerId,
    capturingBrokerName,
    sellerBrokerId: normalizedCapturingBrokerId,
    sellingBrokerName: capturingBrokerName,
  };
}

export async function generateProposalFromProperty(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  if (!req.userId) {
    return sendProposalError(
      req,
      res,
      401,
      'SESSION_EXPIRED',
      'Usuario nao autenticado.',
      false
    );
  }

  const idempotencyKey = resolveIdempotencyKey(req);
  if (!idempotencyKey) {
    return sendProposalError(
      req,
      res,
      400,
      'PROPOSAL_VALIDATION_FAILED',
      'idempotency_key e obrigatoria para envio da proposta.',
      false
    );
  }

  let payload: ParsedProposalWizard;
  try {
    payload = parseProposalWizardBody((req.body ?? {}) as ProposalWizardBody);
  } catch (error) {
    return sendProposalError(
      req,
      res,
      400,
      'PROPOSAL_VALIDATION_FAILED',
      (error as Error).message,
      false
    );
  }

  let tx: PoolConnection | null = null;
  try {
    tx = await getNegotiationDbConnection();
    await tx.beginTransaction();

    const [idempotencyRows] = await tx.query<ProposalIdempotencyRow[]>(
      `
        SELECT id, negotiation_id, document_id
        FROM negotiation_proposal_idempotency
        WHERE user_id = ? AND idempotency_key = ?
        LIMIT 1
        FOR UPDATE
      `,
      [req.userId, idempotencyKey]
    );

    const existingIdempotency = idempotencyRows[0];
    if (
      existingIdempotency &&
      existingIdempotency.negotiation_id &&
      existingIdempotency.document_id
    ) {
      const existingDocument = (await findNegotiationDocumentById(
        Number(existingIdempotency.document_id),
        tx
      )) as { negotiationId?: string | number; fileContent: Buffer } | null;
      if (
        existingDocument &&
        String(existingDocument.negotiationId) === String(existingIdempotency.negotiation_id)
      ) {
        await tx.commit();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="proposal_${existingIdempotency.negotiation_id}.pdf"`
        );
        res.setHeader(
          'Content-Length',
          existingDocument.fileContent.length.toString()
        );
        res.setHeader('X-Negotiation-Id', String(existingIdempotency.negotiation_id));
        res.setHeader('X-Document-Id', String(existingIdempotency.document_id));
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(200).send(existingDocument.fileContent);
      }

      await tx.rollback();
      return sendProposalError(
        req,
        res,
        409,
        'PROPOSAL_IN_PROGRESS',
        'Uma proposta com essa chave de idempotencia ainda esta em processamento.',
        true
      );
    }

    if (!existingIdempotency) {
      await tx.execute(
        `
          INSERT INTO negotiation_proposal_idempotency (user_id, idempotency_key)
          VALUES (?, ?)
        `,
        [req.userId, idempotencyKey]
      );
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
        LIMIT 1
        FOR UPDATE
      `,
      [payload.propertyId]
    );

    const property = propertyRows[0];
    if (!property) {
      await tx.rollback();
      return res.status(404).json({ error: 'Imovel nao encontrado.' });
    }
    const userRole = String(req.userRole ?? '').trim().toLowerCase();
    const isClientUser = userRole === 'client';
    const isBrokerUser = userRole === 'broker';
    const isAdminUser = userRole === 'admin';
    if (!isClientUser && !isBrokerUser && !isAdminUser) {
      await tx.rollback();
      return res
        .status(403)
        .json({ error: 'Apenas clientes ou corretores podem enviar proposta.' });
    }
    if (isClientUser && !isBrokerUser) {
      if (Number(property.owner_id ?? 0) === Number(req.userId ?? 0)) {
        await tx.rollback();
        return res.status(403).json({ error: 'Nao e possivel enviar proposta no proprio anuncio.' });
      }
    }
    if (String(property.status ?? '').trim().toLowerCase() !== 'approved') {
      await tx.rollback();
      return res.status(409).json({
        error: 'A proposta só pode ser gerada para imóveis aprovados.',
      });
    }

    const listingValue = resolvePropertyValue(property);
    if (listingValue <= 0) {
      await tx.rollback();
      return res.status(400).json({ error: 'Imovel sem valor valido para gerar proposta.' });
    }

    const body = req.body as ProposalWizardBody;
    const rawDeclared =
      body.proposalValue ??
      body.valorProposta ??
      (req.body as { proposal_value?: unknown }).proposal_value;
    let proposalValue = listingValue;
    if (rawDeclared !== undefined && rawDeclared !== null && String(rawDeclared).trim() !== '') {
      const parsedDeclared = Number(rawDeclared);
      if (!Number.isFinite(parsedDeclared) || parsedDeclared <= 0) {
        await tx.rollback();
        return res.status(400).json({ error: 'proposalValue invalido.' });
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
      return res.status(400).json({
        error: 'A soma dos pagamentos deve ser exatamente igual ao valor total informado na proposta.',
        propertyValue: proposalValue,
        paymentTotal,
      });
    }

    const requestedCapturingBrokerId = isClientUser || isAdminUser
      ? normalizeOptionalPositiveId(property.broker_id)
      : normalizeOptionalPositiveId(req.userId);
    if (isBrokerUser && requestedCapturingBrokerId === null) {
      await tx.rollback();
      return res.status(400).json({ error: 'Corretor captador invalido para esta proposta.' });
    }

    let brokerContext: BrokerProposalContext;
    try {
      brokerContext = await resolveBrokerProposalContext(
        tx,
        requestedCapturingBrokerId,
        payload.sellerBrokerId
      );
    } catch (error) {
      await tx.rollback();
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'Corretor vendedor inválido.',
      });
    }
    const brokerName = brokerContext.capturingBrokerName;

    const cpfKey = normalizeProposalCpfKey(payload.clientCpf);
    if (!isValidCpf(cpfKey)) {
      await tx.rollback();
      return res.status(400).json({ error: 'CPF do cliente invalido na proposta.' });
    }

    const buyerClientId: number | null = isClientUser ? Number(req.userId) : null;
    const sellerClientId: number | null = normalizeOptionalPositiveId(property.owner_id);

    const capturingBrokerId = brokerContext.capturingBrokerId;
    const sellerBrokerId = brokerContext.sellerBrokerId;
    const sellingBrokerName = brokerContext.sellingBrokerName;

    const [existingRows] = await tx.query<NegotiationRow[]>(
      `
        SELECT id, status
        FROM negotiations
        WHERE property_id = ?
          AND status IN (${ACTIVE_NEGOTIATION_STATUSES.map(() => '?').join(', ')})
        LIMIT 1
        FOR UPDATE
      `,
      [payload.propertyId, ...ACTIVE_NEGOTIATION_STATUSES]
    );
    if (existingRows.length > 0) {
      await tx.rollback();
      return sendProposalError(
        req,
        res,
        409,
        'PROPOSAL_ALREADY_EXISTS',
        DUPLICATE_PROPOSAL_CONFLICT_MESSAGE,
        false
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

    const negotiationId = randomUUID();
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
        negotiationId,
        payload.propertyId,
        capturingBrokerId,
        sellerBrokerId,
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
        negotiationId,
        fromStatus,
        DEFAULT_WIZARD_STATUS,
        req.userId,
        JSON.stringify({
          source: 'mobile_proposal_wizard',
          payment: payload.pagamento,
          sellerBrokerId,
          sellerClientId,
          capturingBrokerId,
          buyerClientId,
          clientName: payload.clientName,
          clientCpf: payload.clientCpf,
        }),
      ]
    );

    const proposalData: ProposalData = {
      clientName: payload.clientName,
      clientCpf: payload.clientCpf,
      propertyAddress: resolvePropertyAddress(property),
      brokerName,
      sellingBrokerName,
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
    const documentId = await saveNegotiationProposalDocument(negotiationId, pdfBuffer, tx, {
      originalFileName: 'proposta.pdf',
      generated: true,
      metadata: { source: 'mobile_proposal_wizard' },
    });

    await tx.execute(
      `
        UPDATE negotiation_proposal_idempotency
        SET negotiation_id = ?, document_id = ?
        WHERE user_id = ? AND idempotency_key = ?
      `,
      [negotiationId, documentId, req.userId, idempotencyKey]
    );

    await tx.commit();

    return res.status(201).json({
      message: 'Proposta gerada com sucesso.',
      negotiationId,
      documentId,
    });
  } catch (error: any) {
    if (tx) {
      await tx.rollback();
    }
    console.error('Erro ao gerar proposta por imovel:', error);
    if (error?.code === 'ER_DUP_ENTRY') {
      return sendProposalError(
        req,
        res,
        409,
        'PROPOSAL_IN_PROGRESS',
        'Uma proposta com essa chave de idempotencia ja esta em processamento.',
        true
      );
    }
    if (error instanceof Error && error.message.toLowerCase().includes('proposal_validity_date')) {
      return sendProposalError(
        req,
        res,
        400,
        'PROPOSAL_VALIDATION_FAILED',
        error.message,
        false
      );
    }
    if (isDependencyUnavailableError(error)) {
      return sendProposalError(
        req,
        res,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Servico temporariamente indisponivel. Tente novamente em instantes.',
        true
      );
    }
    return sendProposalError(
      req,
      res,
      500,
      'INTERNAL_SERVER_ERROR',
      'Falha ao gerar proposta.',
      false
    );
  } finally {
    tx?.release();
  }
}
