import type { Response } from 'express';
import { RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { queryNegotiationRows } from './negotiationPersistenceService';

interface NegotiationListRow extends RowDataPacket {
  id: string;
  property_id: number;
  property_title: string | null;
  property_city: string | null;
  property_state: string | null;
  property_image: string | null;
  status: string;
  client_name: string | null;
  client_cpf: string | null;
  proposal_validity_date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  payment_details?: unknown;
  capturing_broker_id?: number | null;
  selling_broker_id?: number | null;
  seller_client_id?: number | null;
  buyer_client_id?: number | null;
  last_draft_edit_at?: Date | string | null;
  final_value?: number | null;
  signed_proposal_count?: number | null;
  property_broker_id?: number | null;
  contract_id?: string | null;
  contract_status?: string | null;
  buyer_approval_status?: string | null;
  seller_approval_status?: string | null;
}

type NegotiationSummaryPayload = {
  id: string;
  propertyId: number;
  propertyTitle: string;
  propertyCity: string | null;
  propertyState: string | null;
  propertyImage: string | null;
  status: string;
  clientName: string | null;
  clientCpf: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  proposalValidUntil: string | null;
  canEditProposal: boolean;
  secondsUntilEditAllowed: number;
  hasSignedProposal: boolean;
  validadeDias: number;
  proposalValue: number | null;
  paymentBreakdown: {
    dinheiro: number;
    permuta: number;
    financiamento: number;
    outros: number;
  } | null;
  hasSignedProposalDocument: boolean;
  propertyBrokerId: number | null;
  sellerBrokerId: number | null;
  sellerClientId: number | null;
  contractId: string | null;
  contractStatus: string | null;
  buyerApprovalStatus: string | null;
  sellerApprovalStatus: string | null;
};

const PRE_SIGNED_PROPOSAL_EDIT_STATUSES = new Set([
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'AWAITING_SIGNATURES',
]);

const PROPOSAL_EDIT_COOLDOWN_MS = 30_000;
const PROPOSAL_LIST_VISIBLE_STATUSES = [
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'DOCUMENTATION_PHASE',
  'REFUSED',
] as const;

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function getNestedObjectValue(
  source: Record<string, unknown>,
  path: readonly string[]
): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized.length > 0 && normalized.toLowerCase() !== 'null') {
      return normalized;
    }
  }
  return null;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function resolveNegotiationClientName(row: NegotiationListRow): string | null {
  const paymentDetails = parseJsonObjectSafe(row.payment_details);
  return firstNonEmptyString(
    row.client_name,
    getNestedObjectValue(paymentDetails, ['details', 'clientName']),
    getNestedObjectValue(paymentDetails, ['details', 'client_name']),
    paymentDetails.clientName,
    paymentDetails.client_name
  );
}

function resolveNegotiationClientCpf(row: NegotiationListRow): string | null {
  const paymentDetails = parseJsonObjectSafe(row.payment_details);
  return firstNonEmptyString(
    row.client_cpf,
    getNestedObjectValue(paymentDetails, ['details', 'clientCpf']),
    getNestedObjectValue(paymentDetails, ['details', 'client_cpf']),
    paymentDetails.clientCpf,
    paymentDetails.client_cpf
  );
}

function mapNegotiationSummaryRow(row: NegotiationListRow): NegotiationSummaryPayload {
  return {
    id: row.id,
    propertyId: Number(row.property_id),
    propertyTitle: row.property_title ?? '',
    propertyCity: row.property_city ?? null,
    propertyState: row.property_state ?? null,
    propertyImage: row.property_image ?? null,
    status: String(row.status ?? '').trim().toUpperCase(),
    clientName: resolveNegotiationClientName(row),
    clientCpf: resolveNegotiationClientCpf(row),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    proposalValidUntil: toIsoString(row.proposal_validity_date),
    canEditProposal: false,
    secondsUntilEditAllowed: 0,
    hasSignedProposal: false,
    validadeDias: 10,
    proposalValue: null,
    paymentBreakdown: null,
    hasSignedProposalDocument: false,
    propertyBrokerId: null,
    sellerBrokerId: null,
    sellerClientId: null,
    contractId: null,
    contractStatus: null,
    buyerApprovalStatus: null,
    sellerApprovalStatus: null,
  };
}

function extractPaymentBreakdownFromDetails(
  details: Record<string, unknown>
):
  | {
      dinheiro: number;
      permuta: number;
      financiamento: number;
      outros: number;
    }
  | null {
  const raw = details.details;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const dinheiro = Number(o.dinheiro ?? 0);
  const permuta = Number(o.permuta ?? 0);
  const financiamento = Number(o.financiamento ?? 0);
  const outros = Number(o.outros ?? 0);
  if (![dinheiro, permuta, financiamento, outros].every((n) => Number.isFinite(n))) {
    return null;
  }
  return { dinheiro, permuta, financiamento, outros };
}

function buildMineNegotiationSummary(
  userId: number,
  row: NegotiationListRow
): NegotiationSummaryPayload {
  const base = mapNegotiationSummaryRow(row);
  const st = String(row.status ?? '')
    .trim()
    .toUpperCase();
  const pd = parseJsonObjectSafe(row.payment_details);
  const rawV = Number((pd as { validadeDias?: unknown }).validadeDias ?? 10);
  const validadeDias = Number.isInteger(rawV) && rawV > 0 ? rawV : 10;
  const breakdown = extractPaymentBreakdownFromDetails(pd);
  const signedCount = Number(row.signed_proposal_count ?? 0);
  const hasSignedProposal = signedCount > 0;

  const canRoleEdit =
    userId === Number(row.capturing_broker_id ?? 0) ||
    userId === Number(row.selling_broker_id ?? 0) ||
    userId === Number(row.buyer_client_id ?? 0);

  let secondsUntilEdit = 0;
  if (
    canRoleEdit &&
    PRE_SIGNED_PROPOSAL_EDIT_STATUSES.has(st) &&
    signedCount === 0
  ) {
    const lastAt = row.last_draft_edit_at
      ? new Date(row.last_draft_edit_at as string | Date).getTime()
      : 0;
    if (Number.isFinite(lastAt) && lastAt > 0) {
      const elapsed = Date.now() - lastAt;
      if (elapsed < PROPOSAL_EDIT_COOLDOWN_MS) {
        secondsUntilEdit = Math.max(
          1,
          Math.ceil((PROPOSAL_EDIT_COOLDOWN_MS - elapsed) / 1000)
        );
      }
    }
  }

  const canEditProposal =
    canRoleEdit &&
    PRE_SIGNED_PROPOSAL_EDIT_STATUSES.has(st) &&
    signedCount === 0 &&
    secondsUntilEdit === 0;

  const finalVal = row.final_value != null ? Number(row.final_value) : null;
  return {
    ...base,
    canEditProposal,
    secondsUntilEditAllowed: secondsUntilEdit,
    hasSignedProposal,
    hasSignedProposalDocument: signedCount > 0,
    validadeDias,
    proposalValue: Number.isFinite(finalVal ?? NaN) ? finalVal : null,
    paymentBreakdown: breakdown,
    propertyBrokerId:
      row.property_broker_id != null && Number.isFinite(Number(row.property_broker_id))
        ? Number(row.property_broker_id)
        : null,
    sellerBrokerId:
      row.selling_broker_id != null && Number.isFinite(Number(row.selling_broker_id))
        ? Number(row.selling_broker_id)
        : null,
    sellerClientId:
      row.seller_client_id != null && Number.isFinite(Number(row.seller_client_id))
        ? Number(row.seller_client_id)
        : null,
    contractId:
      row.contract_id != null && String(row.contract_id).trim().length > 0
        ? String(row.contract_id).trim()
        : null,
    contractStatus:
      row.contract_status != null && String(row.contract_status).trim().length > 0
        ? String(row.contract_status).trim().toUpperCase()
        : null,
    buyerApprovalStatus:
      row.buyer_approval_status != null &&
      String(row.buyer_approval_status).trim().length > 0
        ? String(row.buyer_approval_status).trim().toUpperCase()
        : null,
    sellerApprovalStatus:
      row.seller_approval_status != null &&
      String(row.seller_approval_status).trim().length > 0
        ? String(row.seller_approval_status).trim().toUpperCase()
        : null,
  };
}

type NegotiationColumnFlags = {
  hasSellingBrokerId: boolean;
  hasSellerClientId: boolean;
  hasBuyerClientId: boolean;
  hasClientName: boolean;
  hasClientCpf: boolean;
  hasProposalValidityDate: boolean;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  hasPaymentDetails: boolean;
  hasLastDraftEditAt: boolean;
  hasFinalValue: boolean;
};

async function getNegotiationColumnFlags(): Promise<NegotiationColumnFlags> {
  const rows = await queryNegotiationRows<RowDataPacket>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiations'
        AND column_name IN (
          'selling_broker_id',
          'seller_client_id',
          'buyer_client_id',
          'client_name',
          'client_cpf',
          'proposal_validity_date',
          'created_at',
          'updated_at',
          'payment_details',
          'last_draft_edit_at',
          'final_value'
        )
    `,
    []
  );

  const columns = new Set(
    rows.map((row) => String((row as { column_name?: unknown }).column_name ?? '').trim())
  );

  return {
    hasSellingBrokerId: columns.has('selling_broker_id'),
    hasSellerClientId: columns.has('seller_client_id'),
    hasBuyerClientId: columns.has('buyer_client_id'),
    hasClientName: columns.has('client_name'),
    hasClientCpf: columns.has('client_cpf'),
    hasProposalValidityDate: columns.has('proposal_validity_date'),
    hasCreatedAt: columns.has('created_at'),
    hasUpdatedAt: columns.has('updated_at'),
    hasPaymentDetails: columns.has('payment_details'),
    hasLastDraftEditAt: columns.has('last_draft_edit_at'),
    hasFinalValue: columns.has('final_value'),
  };
}

async function queryMineNegotiationsCurrent(userId: number): Promise<NegotiationSummaryPayload[]> {
  const visiblePlaceholders = PROPOSAL_LIST_VISIBLE_STATUSES.map(() => '?').join(', ');
  const rows = await queryNegotiationRows<NegotiationListRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        p.city AS property_city,
        p.state AS property_state,
        p.broker_id AS property_broker_id,
        MIN(pi.image_url) AS property_image,
        n.status,
        COALESCE(
          NULLIF(n.client_name, ''),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientName')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_name')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientName')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_name'))
        ) AS client_name,
        COALESCE(
          NULLIF(n.client_cpf, ''),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientCpf')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_cpf')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientCpf')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_cpf'))
        ) AS client_cpf,
        n.proposal_validity_date,
        n.created_at,
        n.updated_at,
        n.capturing_broker_id,
        n.selling_broker_id,
        n.seller_client_id,
        n.buyer_client_id,
        n.last_draft_edit_at,
        n.final_value,
        n.payment_details,
        c.id AS contract_id,
        c.status AS contract_status,
        c.buyer_approval_status,
        c.seller_approval_status,
        (
          SELECT COUNT(*)
          FROM negotiation_documents nd
          WHERE nd.negotiation_id = n.id
            AND nd.type = 'other'
            AND nd.document_type = 'contrato_assinado'
        ) AS signed_proposal_count
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN property_images pi ON pi.property_id = p.id
      LEFT JOIN contracts c ON c.negotiation_id = n.id
      WHERE (
        n.capturing_broker_id = ?
        OR n.buyer_client_id = ?
        OR n.seller_client_id = ?
      )
        AND UPPER(TRIM(n.status)) IN (${visiblePlaceholders})
      GROUP BY
        n.id,
        n.property_id,
        p.title,
        p.city,
        p.state,
        p.broker_id,
        n.status,
        client_name,
        client_cpf,
        n.proposal_validity_date,
        n.created_at,
        n.updated_at,
        n.capturing_broker_id,
        n.selling_broker_id,
        n.seller_client_id,
        n.buyer_client_id,
        n.last_draft_edit_at,
        n.final_value,
        n.payment_details,
        c.id,
        c.status,
        c.buyer_approval_status,
        c.seller_approval_status
      ORDER BY n.updated_at DESC, n.created_at DESC
    `,
    [userId, userId, userId, ...PROPOSAL_LIST_VISIBLE_STATUSES]
  );

  return rows.map((row) => buildMineNegotiationSummary(userId, row));
}

async function queryMineNegotiationsLegacy(userId: number): Promise<NegotiationSummaryPayload[]> {
  const flags = await getNegotiationColumnFlags();
  const selectCreatedAt = flags.hasCreatedAt ? 'n.created_at' : 'NULL';
  const selectPaymentDetails = flags.hasPaymentDetails ? 'n.payment_details' : 'NULL';
  const visiblePlaceholders = PROPOSAL_LIST_VISIBLE_STATUSES.map(() => '?').join(', ');

  const rows = await queryNegotiationRows<NegotiationListRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        p.city AS property_city,
        p.state AS property_state,
        p.broker_id AS property_broker_id,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = p.id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image,
        n.status,
        NULL AS client_name,
        NULL AS client_cpf,
        NULL AS proposal_validity_date,
        ${selectCreatedAt} AS created_at,
        ${selectCreatedAt} AS updated_at,
        ${selectPaymentDetails} AS payment_details,
        n.capturing_broker_id,
        NULL AS selling_broker_id,
        NULL AS seller_client_id,
        NULL AS buyer_client_id,
        NULL AS last_draft_edit_at,
        NULL AS final_value,
        0 AS signed_proposal_count,
        c.id AS contract_id,
        c.status AS contract_status,
        c.buyer_approval_status,
        c.seller_approval_status
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN contracts c ON c.negotiation_id = n.id
      WHERE n.capturing_broker_id = ?
        AND UPPER(TRIM(n.status)) IN (${visiblePlaceholders})
      ORDER BY ${flags.hasCreatedAt ? 'n.created_at DESC,' : ''} n.id DESC
    `,
    [userId, ...PROPOSAL_LIST_VISIBLE_STATUSES]
  );

  return rows.map((row) => buildMineNegotiationSummary(userId, row));
}

async function queryMineNegotiationsSchemaAware(
  userId: number
): Promise<NegotiationSummaryPayload[]> {
  const flags = await getNegotiationColumnFlags();

  const selectClientName = flags.hasClientName ? 'n.client_name' : 'NULL';
  const selectClientCpf = flags.hasClientCpf ? 'n.client_cpf' : 'NULL';
  const selectProposalValidityDate = flags.hasProposalValidityDate
    ? 'n.proposal_validity_date'
    : 'NULL';
  const selectCreatedAt = flags.hasCreatedAt ? 'n.created_at' : 'NULL';
  const selectUpdatedAt = flags.hasUpdatedAt
    ? 'n.updated_at'
    : flags.hasCreatedAt
      ? 'n.created_at'
      : 'NULL';
  const selectPaymentDetails = flags.hasPaymentDetails ? 'n.payment_details' : 'NULL';
  const selectLastDraft = flags.hasLastDraftEditAt ? 'n.last_draft_edit_at' : 'NULL';
  const selectFinalValue = flags.hasFinalValue ? 'n.final_value' : 'NULL';
  const selectSignedCount = `(
    SELECT COUNT(*)
    FROM negotiation_documents nd
    WHERE nd.negotiation_id = n.id
      AND nd.type = 'other'
      AND nd.document_type = 'contrato_assinado'
  )`;
  const visiblePlaceholders = PROPOSAL_LIST_VISIBLE_STATUSES.map(() => '?').join(', ');

  const whereClauses = ['n.capturing_broker_id = ?'];
  const params: number[] = [userId];

  if (flags.hasBuyerClientId) {
    whereClauses.push('n.buyer_client_id = ?');
    params.push(userId);
  }
  if (flags.hasSellerClientId) {
    whereClauses.push('n.seller_client_id = ?');
    params.push(userId);
  }

  const selectSelling = flags.hasSellingBrokerId ? 'n.selling_broker_id' : 'NULL';
  const selectSellerClient = flags.hasSellerClientId ? 'n.seller_client_id' : 'NULL';
  const selectBuyer = flags.hasBuyerClientId ? 'n.buyer_client_id' : 'NULL';

  const rows = await queryNegotiationRows<NegotiationListRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        p.city AS property_city,
        p.state AS property_state,
        p.broker_id AS property_broker_id,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = p.id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image,
        n.status,
        ${selectClientName} AS client_name,
        ${selectClientCpf} AS client_cpf,
        ${selectProposalValidityDate} AS proposal_validity_date,
        ${selectCreatedAt} AS created_at,
        ${selectUpdatedAt} AS updated_at,
        ${selectPaymentDetails} AS payment_details,
        n.capturing_broker_id,
        ${selectSelling} AS selling_broker_id,
        ${selectSellerClient} AS seller_client_id,
        ${selectBuyer} AS buyer_client_id,
        ${selectLastDraft} AS last_draft_edit_at,
        ${selectFinalValue} AS final_value,
        ${selectSignedCount} AS signed_proposal_count,
        c.id AS contract_id,
        c.status AS contract_status,
        c.buyer_approval_status,
        c.seller_approval_status
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN contracts c ON c.negotiation_id = n.id
      WHERE (${whereClauses.join(' OR ')})
        AND UPPER(TRIM(n.status)) IN (${visiblePlaceholders})
      ORDER BY ${selectUpdatedAt !== 'NULL' ? `${selectUpdatedAt} DESC,` : ''} ${
        selectCreatedAt !== 'NULL' ? `${selectCreatedAt} DESC,` : ''
      } n.id DESC
    `,
    [...params, ...PROPOSAL_LIST_VISIBLE_STATUSES]
  );

  return rows.map((row) => buildMineNegotiationSummary(userId, row));
}

export async function listMine(
  req: AuthRequest,
  res: Response
): Promise<Response> {
  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  try {
    const data = await queryMineNegotiationsSchemaAware(userId);
    return res.status(200).json({ data });
  } catch (error) {
    console.error('Erro ao listar negociações do usuário:', error);
    return res.status(500).json({ error: 'Falha ao listar negociações.' });
  }
}
