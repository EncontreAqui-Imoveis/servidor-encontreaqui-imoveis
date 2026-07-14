import { Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import {
  generateNegotiationProposalPdf,
  getNegotiationDbConnection,
  saveNegotiationProposalDocument,
} from './negotiationPersistenceService';
import {
  assertProposalValidityDateNotPast,
  buildProposalValidityDate,
  inferDealTypeFromPurpose,
  normalizeOptionalPositiveId,
  normalizeProposalCpfKey,
  normalizeDealType,
  resolvePropertyAddress,
  parseProposalWizardBody,
  type ParsedProposalWizard,
  type ProposalWizardBody,
} from './negotiationProposalSupportService';
import { isValidCpf, normalizeCpfDigits } from '../utils/cpfValidator';
import {
  resolveAdvertiserIdFromProperty,
  resolveNegotiationInitiatorSide,
} from '../utils/negotiationActorResolution';
import { purgeNegotiationProposalDocuments } from './negotiationProposalDocumentCleanupService';
import { isNegotiationActor, isNegotiationAdmin } from '../utils/negotiationActorAccess';

interface NegotiationAccessRow extends RowDataPacket {
  id: string;
  proposer_id: number | null;
  advertiser_id: number | null;
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
  purpose: string | null;
  price: number | null;
  price_sale: number | null;
  price_rent: number | null;
}

interface UserRow extends RowDataPacket {
  id: number;
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

async function resolveBuyerUserIdentity(
  tx: PoolConnection,
  buyerUserId: number
): Promise<{ id: number; name: string }> {
  const normalizedBuyerUserId = normalizeOptionalPositiveId(buyerUserId);
  if (normalizedBuyerUserId === null) {
    throw new Error('buyerUserId invalido.');
  }

  const [rows] = await tx.query<UserRow[]>(
    'SELECT id, name, cpf FROM users WHERE id = ? LIMIT 1',
    [normalizedBuyerUserId]
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Usuario comprador nao encontrado.');
  }

  const name = String(row.name ?? '').trim();
  if (!name) {
    throw new Error('Usuario comprador sem nome valido.');
  }

  return {
    id: normalizedBuyerUserId,
    name,
  };
}

async function resolveBuyerUserIdentityByCpf(
  tx: PoolConnection,
  clientCpf: string
): Promise<{ id: number; name: string } | null> {
  const cpfKey = normalizeCpfDigits(clientCpf);
  if (cpfKey.length !== 11) {
    return null;
  }

  const [rows] = await tx.query<UserRow[]>(
    `
      SELECT id, name, cpf
      FROM users
      WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '') = ?
      LIMIT 1
    `,
    [cpfKey]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  const name = String(row.name ?? '').trim();
  if (!name) {
    return null;
  }

  return {
    id: Number(row.id),
    name,
  };
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

async function resolveUserNameById(
  tx: PoolConnection,
  userId: number | null | undefined
): Promise<string | null> {
  const normalizedUserId = Number(userId ?? 0);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    return null;
  }

  const [rows] = await tx.query<UserRow[]>(
    'SELECT name FROM users WHERE id = ? LIMIT 1',
    [normalizedUserId]
  );
  return rows[0]?.name?.trim() || null;
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
          n.proposer_id,
          n.advertiser_id,
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
          proposer_id: number | null;
          advertiser_id: number | null;
          last_draft_edit_at: Date | string | null;
        }
      | undefined;

    if (!nRow) {
      await tx.rollback();
      return sendProposalError(res, 404, 'Negociação não encontrada.', 'NOT_FOUND');
    }

    const roleForAccess = String(req.userRole ?? '').trim().toLowerCase();
    if (
      !(allowAdmin && isNegotiationAdmin(roleForAccess)) &&
      Number(nRow.proposer_id ?? 0) !== Number(req.userId)
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
          purpose,
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
    const dealType = normalizeDealType(payload.dealType) ?? inferDealTypeFromPurpose(property.purpose);

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
    const propertyBrokerId = normalizeOptionalPositiveId(property.broker_id);
    const advertiserId = resolveAdvertiserIdFromProperty({
      brokerId: property.broker_id,
      ownerId: property.owner_id,
    });
    const initiatorSide = resolveNegotiationInitiatorSide({
      proposerId: nRow.proposer_id,
      advertiserId,
      propertyOwnerId: property.owner_id,
    });
    const existingCapturingBrokerId = normalizeOptionalPositiveId(nRow.capturing_broker_id);
    const requestedCapturingBrokerId =
      propertyBrokerId ?? existingCapturingBrokerId ?? (isBrokerUser ? normalizeOptionalPositiveId(req.userId) : null);
    if (isBrokerUser && requestedCapturingBrokerId === null) {
      await tx.rollback();
      return sendProposalError(
        res,
        400,
        'Corretor captador invalido para esta proposta.',
        'PROPOSAL_VALIDATION_FAILED'
      );
    }
    if (
      existingCapturingBrokerId != null &&
      requestedCapturingBrokerId != null &&
      existingCapturingBrokerId !== requestedCapturingBrokerId
    ) {
      console.warn('Normalizando captador legado da proposta ao salvar minuta.', {
        negotiationId,
        existingCapturingBrokerId,
        requestedCapturingBrokerId,
        propertyBrokerId,
      });
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
          capturing_broker_id = ?,
          selling_broker_id = ?,
          advertiser_id = ?,
          initiator_side = ?,
          deal_type = ?,
          client_name = ?,
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
        requestedCapturingBrokerId,
        requestedCapturingBrokerId,
        advertiserId,
        initiatorSide,
        dealType,
        payload.clientName,
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
          sellerBrokerId: requestedCapturingBrokerId,
          advertiserId: nRow.advertiser_id,
          capturingBrokerId: requestedCapturingBrokerId,
          proposerId: nRow.proposer_id,
          dealType,
          clientName: payload.clientName,
          clientCpf: payload.clientCpf,
          adminId: allowAdmin && roleForAccess === 'admin' ? req.userId : null,
        }),
      ]
    );

    const proposalData: ProposalData = {
      clientName: payload.clientName,
      clientCpf: payload.clientCpf,
      propertyAddress: resolvePropertyAddress(property),
      dealType,
      brokerName: (await resolveUserNameById(tx, requestedCapturingBrokerId ?? nRow.capturing_broker_id)) ?? '',
      sellingBrokerName:
        (await resolveUserNameById(tx, requestedCapturingBrokerId ?? nRow.selling_broker_id)) ?? null,
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
      metadata: { source: 'mobile_proposal_wizard_update' },
    });
    await purgeNegotiationProposalDocuments(tx, negotiationId, {
      keepDocumentId: documentId,
      requestedByUserId: Number(req.userId),
      requestSource: 'proposal_edit_save',
    });

    await tx.commit();

    return res.status(200).json({
      negotiationId,
      propertyId: payload.propertyId,
      clientName: payload.clientName,
      clientCpf: payload.clientCpf,
      proposerId: nRow.proposer_id,
      advertiserId: nRow.advertiser_id,
      validityDays: payload.validadeDias,
      value: Number(proposalValue.toFixed(2)),
      payment: {
        dinheiro: payload.pagamento.dinheiro,
        permuta: payload.pagamento.permuta,
        financiamento: payload.pagamento.financiamento,
        outros: payload.pagamento.outros,
      },
      status: DEFAULT_WIZARD_STATUS,
      documentId,
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
      'SELECT id, proposer_id, advertiser_id, status FROM negotiations WHERE id = ? FOR UPDATE',
      [negotiationId]
    );
    const row = rows[0];
    if (!row) {
      await tx.rollback();
      return res.status(404).json({ error: 'Negociação não encontrada.' });
    }
    if (!isNegotiationAdmin(req.userRole) && Number(row.proposer_id ?? 0) !== userId) {
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
    await purgeNegotiationProposalDocuments(tx, negotiationId, {
      requestedByUserId: userId,
      requestSource: 'proposal_delete',
    });
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
