import type { RowDataPacket } from 'mysql2';

import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';
import { notifyUsers, resolveUserNotificationRole } from './userNotificationService';
import {
  buildEditablePropertyState,
  buildPropertyEditDbPatch,
  preparePropertyEditPatch,
  type EditablePropertyDiff,
  type EditablePropertyPatch,
} from './propertyEditRequestService';

type PropertyEditRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED';

type PropertyEditRequestListRow = RowDataPacket & {
  id: number | string;
  property_id: number | string;
  requester_user_id: number | string;
  requester_role: string | null;
  status: string | null;
  before_json: unknown;
  after_json: unknown;
  diff_json: unknown;
  field_reviews_json: unknown;
  review_reason: string | null;
  reviewed_by: number | string | null;
  reviewed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  property_title: string | null;
  property_code: string | null;
  requester_name: string | null;
};

type PropertyEditFieldReviewDecision = 'APPROVED' | 'REJECTED';
type PropertyEditFieldReview = {
  decision: PropertyEditFieldReviewDecision;
  reason?: string | null;
};

type PropertyEditRequestListItem = {
  id: number;
  propertyId: number;
  propertyTitle: string | null;
  propertyCode: string | null;
  requesterUserId: number;
  requesterRole: string;
  requesterName: string | null;
  status: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  diff: Record<string, unknown>;
  fieldReviews: Record<string, unknown>;
  reviewReason: string | null;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const PROPERTY_EDIT_FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  type: 'Tipo',
  purpose: 'Finalidade',
  code: 'Código',
  ownerName: 'Nome do proprietário',
  ownerPhone: 'Telefone do proprietário',
  address: 'Endereço',
  quadra: 'Quadra',
  lote: 'Lote',
  numero: 'Número',
  bairro: 'Bairro',
  complemento: 'Complemento',
  semCep: 'Sem CEP',
  city: 'Cidade',
  state: 'Estado',
  cep: 'CEP',
  bedrooms: 'Quartos',
  bathrooms: 'Banheiros',
  areaConstruida: 'Área construída',
  areaTerreno: 'Área do terreno',
  garageSpots: 'Garagens',
  hasWifi: 'Wi-Fi',
  temPiscina: 'Piscina',
  temEnergiaSolar: 'Energia solar',
  temAutomacao: 'Automação',
  temArCondicionado: 'Ar-condicionado',
  ehMobiliada: 'Mobiliada',
  valorCondominio: 'Condomínio',
  priceSale: 'Preço de venda',
  priceRent: 'Preço de aluguel',
  isPromoted: 'Promoção ativa',
  promotionPercentage: '% Promoção',
  promotionPrice: 'Preço promocional venda',
  promotionalRentPrice: 'Preço promocional aluguel',
  promotionalRentPercentage: '% Promoção aluguel',
  promotionStart: 'Início da promoção',
  promotionEnd: 'Fim da promoção',
};

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || value === '') {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function buildUpdateStatementFromPatch(
  dbPatch: Record<string, unknown>
): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(dbPatch)) {
    assignments.push(`\`${key}\` = ?`);
    values.push(value);
  }

  return { assignments, values };
}

function mapPropertyEditRequest(row: PropertyEditRequestListRow): PropertyEditRequestListItem {
  return {
    id: Number(row.id),
    propertyId: Number(row.property_id),
    propertyTitle: row.property_title ?? null,
    propertyCode: row.property_code ?? null,
    requesterUserId: Number(row.requester_user_id),
    requesterRole: String(row.requester_role ?? '').toLowerCase(),
    requesterName: row.requester_name ?? null,
    status: String(row.status ?? '').toUpperCase(),
    before: parseJsonObjectSafe(row.before_json),
    after: parseJsonObjectSafe(row.after_json),
    diff: parseJsonObjectSafe(row.diff_json),
    fieldReviews: parseJsonObjectSafe(row.field_reviews_json),
    reviewReason: row.review_reason ?? null,
    reviewedBy: row.reviewed_by != null ? Number(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

function normalizeStatusFilter(value: unknown): PropertyEditRequestStatus | 'ALL' {
  const requested = String(value ?? 'PENDING').trim().toUpperCase();
  const allowed = new Set<PropertyEditRequestStatus | 'ALL'>([
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PARTIALLY_APPROVED',
    'ALL',
  ]);
  return allowed.has(requested as PropertyEditRequestStatus | 'ALL')
    ? (requested as PropertyEditRequestStatus | 'ALL')
    : 'PENDING';
}

function normalizeFieldReviews(
  rawValue: unknown,
  diff: EditablePropertyDiff
): Record<string, PropertyEditFieldReview> {
  const raw = parseJsonObjectSafe(rawValue);
  const reviews: Record<string, PropertyEditFieldReview> = {};
  const diffKeys = Object.keys(diff);

  for (const key of diffKeys) {
    const candidate = parseJsonObjectSafe(raw[key]);
    const decision = String(candidate.decision ?? '').trim().toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new Error(`Campo "${PROPERTY_EDIT_FIELD_LABELS[key] ?? key}" precisa ser aprovado ou rejeitado.`);
    }

    const reason = String(candidate.reason ?? '').trim();
    if (decision === 'REJECTED' && reason.length === 0) {
      throw new Error(`Informe o motivo da rejeição para "${PROPERTY_EDIT_FIELD_LABELS[key] ?? key}".`);
    }

    reviews[key] = {
      decision: decision as PropertyEditFieldReviewDecision,
      reason: reason.length > 0 ? reason : null,
    };
  }

  for (const key of Object.keys(raw)) {
    if (!diffKeys.includes(key)) {
      throw new Error(`Campo "${key}" não pertence a esta solicitação de edição.`);
    }
  }

  return reviews;
}

function resolveReviewedRequestStatus(
  fieldReviews: Record<string, PropertyEditFieldReview>
): 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED' {
  const decisions = Object.values(fieldReviews).map((item) => item.decision);
  const approvedCount = decisions.filter((item) => item === 'APPROVED').length;
  const rejectedCount = decisions.filter((item) => item === 'REJECTED').length;

  if (approvedCount > 0 && rejectedCount > 0) {
    return 'PARTIALLY_APPROVED';
  }
  if (approvedCount > 0) {
    return 'APPROVED';
  }
  return 'REJECTED';
}

function extractApprovedPatch(
  after: Record<string, unknown>,
  fieldReviews: Record<string, PropertyEditFieldReview>
): EditablePropertyPatch {
  const approvedPatch: Record<string, unknown> = {};
  for (const [key, review] of Object.entries(fieldReviews)) {
    if (review.decision !== 'APPROVED') continue;
    if (Object.prototype.hasOwnProperty.call(after, key)) {
      approvedPatch[key] = after[key];
    }
  }
  return approvedPatch as EditablePropertyPatch;
}

function buildRejectedReviewSummary(
  fieldReviews: Record<string, PropertyEditFieldReview>
): string | null {
  const rejectedItems = Object.entries(fieldReviews)
    .filter(([, review]) => review.decision === 'REJECTED')
    .map(([key, review]) => `${PROPERTY_EDIT_FIELD_LABELS[key] ?? key}: ${review.reason}`);

  if (rejectedItems.length === 0) {
    return null;
  }

  return rejectedItems.join(' | ');
}

export async function listPropertyEditRequests(params: {
  page: number;
  limit: number;
  status?: string;
}): Promise<{
  data: PropertyEditRequestListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(Number(params.page || 1), 1);
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), 100);
  const offset = (page - 1) * limit;
  const normalizedStatus = normalizeStatusFilter(params.status);

  const whereClause = normalizedStatus === 'ALL' ? '' : 'WHERE per.status = ?';
  const whereParams = normalizedStatus === 'ALL' ? [] : [normalizedStatus];

  const [countRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM property_edit_requests per
      ${whereClause}
    `,
    whereParams
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await adminDb.query<PropertyEditRequestListRow[]>(
    `
      SELECT
        per.id,
        per.property_id,
        per.requester_user_id,
        per.requester_role,
        per.status,
        per.before_json,
        per.after_json,
        per.diff_json,
        per.field_reviews_json,
        per.review_reason,
        per.reviewed_by,
        per.reviewed_at,
        per.created_at,
        per.updated_at,
        p.title AS property_title,
        p.code AS property_code,
        u.name AS requester_name
      FROM property_edit_requests per
      INNER JOIN properties p ON p.id = per.property_id
      INNER JOIN users u ON u.id = per.requester_user_id
      ${whereClause}
      ORDER BY per.created_at DESC, per.id DESC
      LIMIT ? OFFSET ?
    `,
    [...whereParams, limit, offset]
  );

  return {
    data: rows.map((row) => mapPropertyEditRequest(row)),
    total,
    page,
    limit,
  };
}

export async function getPropertyEditRequestById(requestId: number): Promise<PropertyEditRequestListItem> {
  if (!Number.isFinite(requestId)) {
    throw new InvalidInputError('Identificador da solicitacao invalido.');
  }

  const [rows] = await adminDb.query<PropertyEditRequestListRow[]>(
    `
      SELECT
        per.id,
        per.property_id,
        per.requester_user_id,
        per.requester_role,
        per.status,
        per.before_json,
        per.after_json,
        per.diff_json,
        per.field_reviews_json,
        per.review_reason,
        per.reviewed_by,
        per.reviewed_at,
        per.created_at,
        per.updated_at,
        p.title AS property_title,
        p.code AS property_code,
        u.name AS requester_name
      FROM property_edit_requests per
      INNER JOIN properties p ON p.id = per.property_id
      INNER JOIN users u ON u.id = per.requester_user_id
      WHERE per.id = ?
      LIMIT 1
    `,
    [requestId]
  );

  if (rows.length === 0) {
    throw new NotFoundError('Solicitacao de edicao nao encontrada.');
  }

  return mapPropertyEditRequest(rows[0]);
}

async function reviewPropertyEditRequestInternal(params: {
  requestId: number;
  reviewerId: number | null;
  body: Record<string, unknown>;
}): Promise<{
  message: string;
  status: 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED';
  fieldReviews: Record<string, PropertyEditFieldReview>;
}> {
  const requestId = Number(params.requestId);
  if (!Number.isFinite(requestId)) {
    throw new InvalidInputError('Identificador da solicitacao invalido.');
  }

  const db = await adminDb.getConnection();
  let committed = false;
  try {
    await db.beginTransaction();

    const [requestRows] = await db.query<PropertyEditRequestListRow[]>(
      `
        SELECT
          per.id,
          per.property_id,
          per.requester_user_id,
          per.requester_role,
          per.status,
          per.before_json,
          per.after_json,
          per.diff_json,
          per.field_reviews_json,
          per.review_reason,
          per.reviewed_by,
          per.reviewed_at,
          per.created_at,
          per.updated_at,
          p.title AS property_title,
          p.code AS property_code,
          u.name AS requester_name
        FROM property_edit_requests per
        INNER JOIN properties p ON p.id = per.property_id
        INNER JOIN users u ON u.id = per.requester_user_id
        WHERE per.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [requestId]
    );

    if (requestRows.length === 0) {
      await db.rollback();
      throw new NotFoundError('Solicitacao de edicao nao encontrada.');
    }

    const requestRow = requestRows[0];
    if (String(requestRow.status ?? '').toUpperCase() !== 'PENDING') {
      await db.rollback();
      throw new ConflictError('Esta solicitacao nao esta mais pendente.');
    }

    const diff = parseJsonObjectSafe(requestRow.diff_json) as EditablePropertyDiff;
    const diffKeys = Object.keys(diff);
    if (diffKeys.length === 0) {
      await db.rollback();
      throw new InvalidInputError('Esta solicitacao nao possui campos alterados.');
    }

    let fieldReviews: Record<string, PropertyEditFieldReview>;
    const reviewMode = String(params.body.mode ?? '').trim().toLowerCase();
    if (reviewMode === 'approve_all') {
      fieldReviews = Object.fromEntries(
        diffKeys.map((key) => [key, { decision: 'APPROVED' as const }])
      );
    } else if (reviewMode === 'reject_all') {
      const reason = String(params.body.reason ?? '').trim();
      if (!reason) {
        await db.rollback();
        throw new InvalidInputError('Informe o motivo da rejeicao.');
      }
      fieldReviews = Object.fromEntries(
        diffKeys.map((key) => [key, { decision: 'REJECTED' as const, reason }])
      );
    } else {
      fieldReviews = normalizeFieldReviews(params.body.fieldReviews, diff);
    }

    const [propertyRows] = await db.query<RowDataPacket[]>(
      'SELECT * FROM properties WHERE id = ? LIMIT 1 FOR UPDATE',
      [requestRow.property_id]
    );

    if (propertyRows.length === 0) {
      await db.rollback();
      throw new NotFoundError('Imovel nao encontrado.');
    }

    const property = propertyRows[0] as Record<string, unknown>;
    const currentState = buildEditablePropertyState(property);
    const afterPayload = parseJsonObjectSafe(requestRow.after_json);
    const approvedPatch = extractApprovedPatch(afterPayload, fieldReviews);
    const preparedApprovedPatch = preparePropertyEditPatch(approvedPatch, currentState);
    const dbPatch = buildPropertyEditDbPatch(currentState, preparedApprovedPatch.patch);
    const updateStatement = buildUpdateStatementFromPatch(dbPatch);

    if (updateStatement.assignments.length > 0) {
      await db.query(
        `
          UPDATE properties
          SET ${updateStatement.assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [...updateStatement.values, requestRow.property_id]
      );
    }

    const resolvedStatus = resolveReviewedRequestStatus(fieldReviews);
    const rejectedSummary = buildRejectedReviewSummary(fieldReviews);

    await db.query(
      `
        UPDATE property_edit_requests
        SET
          status = ?,
          field_reviews_json = CAST(? AS JSON),
          review_reason = ?,
          reviewed_by = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        resolvedStatus,
        JSON.stringify(fieldReviews),
        rejectedSummary,
        params.reviewerId,
        requestId,
      ]
    );

    await db.commit();
    committed = true;

    if (rejectedSummary) {
      try {
        const rawBrokerId = Number(property.broker_id ?? 0);
        const recipientId =
          Number.isFinite(rawBrokerId) && rawBrokerId > 0
            ? rawBrokerId
            : Number(requestRow.requester_user_id);
        const recipientRole = await resolveUserNotificationRole(recipientId);
        const propertyTitle =
          String(requestRow.property_title ?? '').trim() || `Imóvel #${requestRow.property_id}`;

        await notifyUsers({
          message: `A edição do imóvel "${propertyTitle}" teve campos rejeitados: ${rejectedSummary}.`,
          recipientIds: [recipientId],
          recipientRole,
          relatedEntityType: 'property',
          relatedEntityId: Number(requestRow.property_id),
        });
      } catch (notifyError) {
        console.error('Erro ao enviar notificação da revisão parcial:', notifyError);
      }
    }

    return {
      message: 'Solicitacao de edicao revisada com sucesso.',
      status: resolvedStatus,
      fieldReviews,
    };
  } catch (error) {
    if (!committed) {
      await db.rollback();
    }
    throw error;
  } finally {
    db.release();
  }
}

export async function reviewPropertyEditRequest(params: {
  requestId: number;
  reviewerId: number | null;
  body: Record<string, unknown>;
}): Promise<{
  message: string;
  status: 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED';
  fieldReviews: Record<string, PropertyEditFieldReview>;
}> {
  return reviewPropertyEditRequestInternal(params);
}

export async function approvePropertyEditRequest(params: {
  requestId: number;
  reviewerId: number | null;
}): Promise<{
  message: string;
  status: 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED';
  fieldReviews: Record<string, PropertyEditFieldReview>;
}> {
  return reviewPropertyEditRequestInternal({
    requestId: params.requestId,
    reviewerId: params.reviewerId,
    body: { mode: 'approve_all' },
  });
}

export async function rejectPropertyEditRequest(params: {
  requestId: number;
  reviewerId: number | null;
  reason?: string | null;
}): Promise<{
  message: string;
  status: 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED';
  fieldReviews: Record<string, PropertyEditFieldReview>;
}> {
  return reviewPropertyEditRequestInternal({
    requestId: params.requestId,
    reviewerId: params.reviewerId,
    body: {
      mode: 'reject_all',
      reason: params.reason ?? null,
    },
  });
}
