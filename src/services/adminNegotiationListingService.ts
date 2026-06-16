import { RowDataPacket } from 'mysql2';

import { adminDb } from './adminPersistenceService';

const NEGOTIATION_INTERNAL_STATUSES = new Set([
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'PROPOSAL_SIGNED',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
  'CANCELLED',
  'REFUSED',
]);

type NegotiationTimeSqlFragments = {
  nEventAtSelect: string;
  n2EventAtSelect: string;
  nEventSort: string;
  n2EventSort: string;
};

type NegotiationClientSqlFragments = {
  clientName: string;
  clientCpf: string;
  paymentDinheiro: string;
  paymentPermuta: string;
  paymentFinanciamento: string;
  paymentOutros: string;
};

interface AdminNegotiationListRow extends RowDataPacket {
  id: string;
  negotiation_status: string | null;
  property_id: number | string;
  created_at: string | Date | null;
  capturing_broker_id: number | string | null;
  selling_broker_id: number | string | null;
  seller_client_id: number | string | null;
  property_status: string | null;
  property_code: string | null;
  property_title: string | null;
  property_address: string | null;
  property_image_url: string | null;
  property_value: number | string | null;
  final_value: number | string | null;
  proposal_validity_date: string | Date | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
  seller_client_name: string | null;
  client_name: string | null;
  client_cpf: string | null;
  payment_dinheiro: number | string | null;
  payment_permuta: number | string | null;
  payment_financiamento: number | string | null;
  payment_outros: number | string | null;
  last_event_at: string | Date | null;
  approved_at: string | Date | null;
  signed_document_id: number | string | null;
  signed_document_metadata_json: string | null;
  draft_document_id: number | string | null;
  draft_document_metadata_json: string | null;
}

interface AdminNegotiationRequestSummaryRow extends RowDataPacket {
  property_id: number | string;
  property_code: string | null;
  property_title: string | null;
  property_address: string | null;
  property_image_url: string | null;
  property_value: number | string | null;
  proposal_count: number | string | null;
  latest_updated_at: string | Date | null;
  top_negotiation_id: string | null;
  top_proposal_value: number | string | null;
  top_client_name: string | null;
  top_created_at: string | Date | null;
}

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

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableIsoDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function toNegotiationMoney(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(2));
}

export function parseNegotiationStatusFilter(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'REJECTED') {
    return 'REFUSED';
  }
  if (
    normalized === 'UNDER_REVIEW' ||
    normalized === 'APPROVED' ||
    normalized === 'PROPOSAL_UNSIGNED' ||
    normalized === 'PROPOSAL_SIGNED' ||
    normalized === 'REFUSED'
  ) {
    return normalized;
  }
  if (NEGOTIATION_INTERNAL_STATUSES.has(normalized)) {
    return normalized;
  }
  return null;
}

export function isInvalidNegotiationStatusFilter(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return parseNegotiationStatusFilter(value) === null;
}

function buildNegotiationStatusClause(
  statusFilter: string | null
): { clause: string; params: string[] } {
  if (!statusFilter) {
    return { clause: '', params: [] };
  }

  if (statusFilter === 'UNDER_REVIEW') {
    return {
      clause:
        " AND (n.status = 'PROPOSAL_SENT' OR (n.status = 'DOCUMENTATION_PHASE' AND COALESCE(p.status, '') <> 'negociacao') OR (n.status = 'IN_NEGOTIATION' AND COALESCE(p.status, '') <> 'negociacao'))",
      params: [],
    };
  }

  if (statusFilter === 'APPROVED' || statusFilter === 'IN_NEGOTIATION') {
    return {
      clause:
        " AND n.status IN ('IN_NEGOTIATION', 'DOCUMENTATION_PHASE') AND COALESCE(p.status, '') = 'negociacao'",
      params: [],
    };
  }

  if (statusFilter === 'PROPOSAL_UNSIGNED') {
    return {
      clause:
        " AND n.status = 'PROPOSAL_SENT' AND NOT EXISTS (SELECT 1 FROM negotiation_documents nd_unsigned WHERE nd_unsigned.negotiation_id = n.id AND nd_unsigned.type = 'other' AND nd_unsigned.document_type = 'contrato_assinado')",
      params: [],
    };
  }

  if (statusFilter === 'PROPOSAL_SIGNED') {
    return {
      clause:
        " AND n.status IN ('PROPOSAL_SENT', 'DOCUMENTATION_PHASE') AND EXISTS (SELECT 1 FROM negotiation_documents nd_signed WHERE nd_signed.negotiation_id = n.id AND nd_signed.type = 'other' AND nd_signed.document_type = 'contrato_assinado')",
      params: [],
    };
  }

  if (statusFilter === 'REFUSED') {
    return {
      clause: " AND n.status = 'REFUSED'",
      params: [],
    };
  }

  return {
    clause: ' AND n.status = ?',
    params: [statusFilter],
  };
}

async function resolveNegotiationTimeSqlFragments(): Promise<NegotiationTimeSqlFragments> {
  try {
    const [rows] = await adminDb.query<RowDataPacket[]>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'negotiations'
          AND column_name IN ('updated_at', 'created_at')
      `
    );
    const available = new Set(rows.map((row) => String(row.column_name ?? '').toLowerCase()));
    const hasUpdatedAt = available.has('updated_at');
    const hasCreatedAt = available.has('created_at');

    const nEventAtSelect = hasUpdatedAt
      ? 'COALESCE(n.updated_at, n.created_at)'
      : hasCreatedAt
      ? 'n.created_at'
      : 'NULL';
    const n2EventAtSelect = hasUpdatedAt
      ? 'COALESCE(n2.updated_at, n2.created_at)'
      : hasCreatedAt
      ? 'n2.created_at'
      : 'NULL';

    return {
      nEventAtSelect,
      n2EventAtSelect,
      nEventSort: nEventAtSelect,
      n2EventSort: n2EventAtSelect,
    };
  } catch {
    return {
      nEventAtSelect: 'NULL',
      n2EventAtSelect: 'NULL',
      nEventSort: 'NULL',
      n2EventSort: 'NULL',
    };
  }
}

async function resolveNegotiationClientSqlFragments(): Promise<NegotiationClientSqlFragments> {
  try {
    const [rows] = await adminDb.query<RowDataPacket[]>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'negotiations'
          AND column_name IN ('client_name', 'client_cpf', 'payment_details')
      `
    );

    const available = new Set(rows.map((row) => String(row.column_name ?? '').toLowerCase()));
    const hasClientName = available.has('client_name');
    const hasClientCpf = available.has('client_cpf');
    const hasPaymentDetails = available.has('payment_details');

    const paymentDetailsClientNameExpr = hasPaymentDetails
      ? `COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientName')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_name')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientName')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_name'))
          )`
      : 'NULL';
    const paymentDetailsClientCpfExpr = hasPaymentDetails
      ? `COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientCpf')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_cpf')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientCpf')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_cpf'))
          )`
      : 'NULL';
    const paymentDetailsDinheiroExpr = hasPaymentDetails
      ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.dinheiro')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.paymentDinheiro')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.paymentDinheiro')) AS DECIMAL(18,2))
          )`
      : 'NULL';
    const paymentDetailsPermutaExpr = hasPaymentDetails
      ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.permuta')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.paymentPermuta')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.paymentPermuta')) AS DECIMAL(18,2))
          )`
      : 'NULL';
    const paymentDetailsFinanciamentoExpr = hasPaymentDetails
      ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.financiamento')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.paymentFinanciamento')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.paymentFinanciamento')) AS DECIMAL(18,2))
          )`
      : 'NULL';
    const paymentDetailsOutrosExpr = hasPaymentDetails
      ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.outros')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.paymentOutros')) AS DECIMAL(18,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.paymentOutros')) AS DECIMAL(18,2))
          )`
      : 'NULL';

    return {
      clientName: hasClientName
        ? 'n.client_name'
        : paymentDetailsClientNameExpr,
      clientCpf: hasClientCpf
        ? 'n.client_cpf'
        : paymentDetailsClientCpfExpr,
      paymentDinheiro: paymentDetailsDinheiroExpr,
      paymentPermuta: paymentDetailsPermutaExpr,
      paymentFinanciamento: paymentDetailsFinanciamentoExpr,
      paymentOutros: paymentDetailsOutrosExpr,
    };
  } catch {
    return {
      clientName: 'NULL',
      clientCpf: 'NULL',
      paymentDinheiro: 'NULL',
      paymentPermuta: 'NULL',
      paymentFinanciamento: 'NULL',
      paymentOutros: 'NULL',
    };
  }
}

function toAdminNegotiationStatus(row: AdminNegotiationListRow): string {
  const negotiationStatus = String(row.negotiation_status ?? '').toUpperCase();
  const propertyStatus = String(row.property_status ?? '').toLowerCase();

  if (negotiationStatus === 'PROPOSAL_SENT') {
    return 'UNDER_REVIEW';
  }

  if (negotiationStatus === 'DOCUMENTATION_PHASE' && propertyStatus === 'negociacao') {
    return 'APPROVED';
  }

  if (negotiationStatus === 'DOCUMENTATION_PHASE') {
    return 'UNDER_REVIEW';
  }

  if (negotiationStatus === 'IN_NEGOTIATION' && propertyStatus !== 'negociacao') {
    return 'UNDER_REVIEW';
  }

  if (negotiationStatus === 'IN_NEGOTIATION' && propertyStatus === 'negociacao') {
    return 'APPROVED';
  }

  return negotiationStatus;
}

function mapAdminNegotiation(row: AdminNegotiationListRow) {
  const signedDocumentMetadata = parseJsonObjectSafe(row.signed_document_metadata_json);
  const signedDocumentFileName = String(signedDocumentMetadata.originalFileName ?? '').trim();
  const draftDocumentMetadata = parseJsonObjectSafe(row.draft_document_metadata_json);
  const draftDocumentFileName = String(draftDocumentMetadata.originalFileName ?? '').trim();

  return {
    id: row.id,
    status: toAdminNegotiationStatus(row),
    internalStatus: String(row.negotiation_status ?? '').toUpperCase(),
    propertyId: Number(row.property_id),
    propertyCode: row.property_code ?? null,
    propertyTitle: row.property_title ?? null,
    propertyAddress: row.property_address ?? null,
    propertyImageUrl: row.property_image_url ?? null,
    propertyValue: toNullableNumber(row.property_value),
    capturingBrokerId: row.capturing_broker_id != null ? Number(row.capturing_broker_id) : null,
    sellingBrokerId: row.selling_broker_id != null ? Number(row.selling_broker_id) : null,
    sellerClientId: row.seller_client_id != null ? Number(row.seller_client_id) : null,
    brokerName: row.capturing_broker_name ?? row.selling_broker_name ?? null,
    capturingBrokerName: row.capturing_broker_name ?? null,
    sellingBrokerName: row.selling_broker_name ?? null,
    sellerClientName: row.seller_client_name ?? null,
    clientName: row.client_name ?? null,
    clientCpf: row.client_cpf ?? null,
    value: toNullableNumber(row.final_value),
    createdAt: toNullableIsoDate(row.created_at),
    validityDate: row.proposal_validity_date ? String(row.proposal_validity_date) : null,
    payment: {
      dinheiro: toNegotiationMoney(row.payment_dinheiro),
      permuta: toNegotiationMoney(row.payment_permuta),
      financiamento: toNegotiationMoney(row.payment_financiamento),
      outros: toNegotiationMoney(row.payment_outros),
    },
    updatedAt: toNullableIsoDate(row.last_event_at),
    approvedAt: toNullableIsoDate(row.approved_at),
    signedDocumentId: row.signed_document_id != null ? Number(row.signed_document_id) : null,
    signedDocumentFileName:
      row.signed_document_id != null ? signedDocumentFileName || 'proposta_assinada.pdf' : null,
    draftDocumentId: row.draft_document_id != null ? Number(row.draft_document_id) : null,
    draftDocumentFileName:
      row.draft_document_id != null ? draftDocumentFileName || 'proposta_minuta.pdf' : null,
  };
}

export async function listNegotiations(params: {
  statusFilter: string | null;
  page: number;
  limit: number;
}): Promise<{ data: ReturnType<typeof mapAdminNegotiation>[]; page: number; limit: number; total: number }> {
  const { statusFilter, page, limit } = params;
  const offset = (page - 1) * limit;
  const { clause, params: clauseParams } = buildNegotiationStatusClause(statusFilter);
  const clientSql = await resolveNegotiationClientSqlFragments();
  const timeSql = await resolveNegotiationTimeSqlFragments();

  const [countRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      WHERE 1 = 1
      ${clause}
    `,
    clauseParams
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await adminDb.query<AdminNegotiationListRow[]>(
    `
      SELECT
        n.id,
        n.status AS negotiation_status,
        n.property_id,
        ${timeSql.nEventAtSelect} AS created_at,
        n.capturing_broker_id,
        n.selling_broker_id,
        n.seller_client_id,
        p.status AS property_status,
        p.code AS property_code,
        p.title AS property_title,
        CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
        COALESCE(NULLIF(p.price_sale, 0), NULLIF(p.price_rent, 0), NULLIF(p.price, 0)) AS property_value,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = n.property_id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image_url,
        n.final_value,
        n.proposal_validity_date,
        capture_user.name AS capturing_broker_name,
        seller_user.name AS selling_broker_name,
        seller_client_user.name AS seller_client_name,
        ${clientSql.clientName} AS client_name,
        ${clientSql.clientCpf} AS client_cpf,
        ${clientSql.paymentDinheiro} AS payment_dinheiro,
        ${clientSql.paymentPermuta} AS payment_permuta,
        ${clientSql.paymentFinanciamento} AS payment_financiamento,
        ${clientSql.paymentOutros} AS payment_outros,
        latest_history.created_at AS last_event_at,
        approved_history.approved_at AS approved_at,
        signed_doc.id AS signed_document_id,
        signed_doc.metadata_json AS signed_document_metadata_json,
        draft_doc.id AS draft_document_id,
        draft_doc.metadata_json AS draft_document_metadata_json
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
      LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
      LEFT JOIN users seller_client_user ON seller_client_user.id = n.seller_client_id
      LEFT JOIN (
        SELECT
          h.negotiation_id,
          h.created_at
        FROM negotiation_history h
        INNER JOIN (
          SELECT negotiation_id, MAX(id) AS max_id
          FROM negotiation_history
          GROUP BY negotiation_id
        ) hm ON hm.negotiation_id = h.negotiation_id AND h.id = hm.max_id
      ) latest_history ON latest_history.negotiation_id = n.id
      LEFT JOIN (
        SELECT
          h.negotiation_id,
          MAX(h.created_at) AS approved_at
        FROM negotiation_history h
        WHERE h.to_status = 'IN_NEGOTIATION'
        GROUP BY h.negotiation_id
      ) approved_history ON approved_history.negotiation_id = n.id
      LEFT JOIN (
        SELECT
          d.negotiation_id,
          d.id,
          d.metadata_json
        FROM negotiation_documents d
        INNER JOIN (
          SELECT negotiation_id, MAX(id) AS max_id
          FROM negotiation_documents
          WHERE type = 'other'
            AND document_type = 'contrato_assinado'
          GROUP BY negotiation_id
        ) dm ON dm.negotiation_id = d.negotiation_id AND d.id = dm.max_id
      ) signed_doc ON signed_doc.negotiation_id = n.id
      LEFT JOIN (
        SELECT
          d.negotiation_id,
          d.id,
          d.metadata_json
        FROM negotiation_documents d
        INNER JOIN (
          SELECT negotiation_id, MAX(id) AS max_id
          FROM negotiation_documents
          WHERE type = 'proposal'
            AND document_type = 'contrato_minuta'
          GROUP BY negotiation_id
        ) dm ON dm.negotiation_id = d.negotiation_id AND d.id = dm.max_id
      ) draft_doc ON draft_doc.negotiation_id = n.id
      WHERE 1 = 1
      ${clause}
      ORDER BY COALESCE(latest_history.created_at, approved_history.approved_at) DESC, n.id DESC
      LIMIT ? OFFSET ?
    `,
    [...clauseParams, limit, offset]
  );

  return {
    data: rows.map(mapAdminNegotiation),
    page,
    limit,
    total,
  };
}

export async function listNegotiationRequestSummary(params: {
  statusFilter: string | null;
  page: number;
  limit: number;
}): Promise<{
  data: Array<{
    propertyId: number;
    propertyCode: string | null;
    propertyTitle: string | null;
    propertyAddress: string | null;
    propertyImageUrl: string | null;
    propertyValue: number | null;
    proposalCount: number;
    updatedAt: string | null;
    topProposal: {
      negotiationId: string | null;
      value: number | null;
      clientName: string | null;
      createdAt: string | null;
    };
  }>;
  page: number;
  limit: number;
  total: number;
}> {
  const { statusFilter, page, limit } = params;
  const offset = (page - 1) * limit;
  const { clause, params: clauseParams } = buildNegotiationStatusClause(statusFilter ?? 'UNDER_REVIEW');
  const clauseForN2 = clause.replace(/n\./g, 'n2.').replace(/p\./g, 'p2.');
  const clientSql = await resolveNegotiationClientSqlFragments();
  const timeSql = await resolveNegotiationTimeSqlFragments();

  const [countRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(DISTINCT n.property_id) AS total
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      WHERE 1 = 1
      ${clause}
    `,
    clauseParams
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await adminDb.query<AdminNegotiationRequestSummaryRow[]>(
    `
      SELECT
        g.property_id,
        g.property_code,
        g.property_title,
        g.property_address,
        g.property_value,
        g.proposal_count,
        g.latest_updated_at,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = g.property_id
          ORDER BY pi.id ASC
          LIMIT 1
      ) AS property_image_url,
        r.negotiation_id AS top_negotiation_id,
        r.final_value AS top_proposal_value,
        r.client_name AS top_client_name,
        r.created_at AS top_created_at
      FROM (
        SELECT
          n.property_id,
          MAX(p.code) AS property_code,
          MAX(p.title) AS property_title,
          MAX(CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state)) AS property_address,
          MAX(COALESCE(NULLIF(p.price_sale, 0), NULLIF(p.price_rent, 0), NULLIF(p.price, 0))) AS property_value,
          COUNT(*) AS proposal_count,
          MAX(${timeSql.nEventAtSelect}) AS latest_updated_at
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        WHERE 1 = 1
        ${clause}
        GROUP BY n.property_id
      ) g
      JOIN (
        SELECT
          n.id AS negotiation_id,
          n.property_id,
          COALESCE(n.final_value, 0) AS final_value,
          ${timeSql.nEventAtSelect} AS updated_at,
          ${timeSql.nEventSort} AS sort_value,
          ${timeSql.nEventAtSelect} AS created_at,
          ${clientSql.clientName} AS client_name
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        WHERE 1 = 1
        ${clause}
      ) r ON r.property_id = g.property_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM (
          SELECT
            n2.id AS negotiation_id,
            n2.property_id,
            COALESCE(n2.final_value, 0) AS final_value,
            ${timeSql.n2EventAtSelect} AS updated_at,
            ${timeSql.n2EventSort} AS sort_value
          FROM negotiations n2
          JOIN properties p2 ON p2.id = n2.property_id
          WHERE 1 = 1
          ${clauseForN2}
        ) r2
        WHERE r2.property_id = r.property_id
          AND (
            r2.final_value > r.final_value
            OR (r2.final_value = r.final_value AND r2.sort_value > r.sort_value)
            OR (
              r2.final_value = r.final_value
              AND r2.sort_value = r.sort_value
              AND r2.negotiation_id > r.negotiation_id
            )
          )
      )
      ORDER BY g.latest_updated_at DESC, g.property_id DESC
      LIMIT ? OFFSET ?
    `,
    [...clauseParams, ...clauseParams, ...clauseParams, limit, offset]
  );

  return {
    data: rows.map((row) => ({
      propertyId: Number(row.property_id),
      propertyCode: row.property_code ?? null,
      propertyTitle: row.property_title ?? null,
      propertyAddress: row.property_address ?? null,
      propertyImageUrl: row.property_image_url ?? null,
      propertyValue: toNullableNumber(row.property_value),
      proposalCount: Number(row.proposal_count ?? 0),
      updatedAt: toNullableIsoDate(row.latest_updated_at),
      topProposal: {
        negotiationId: row.top_negotiation_id ?? null,
        value: toNullableNumber(row.top_proposal_value),
        clientName: row.top_client_name ?? null,
        createdAt: toNullableIsoDate(row.top_created_at),
      },
    })),
    page,
    limit,
    total,
  };
}

export async function listNegotiationRequestsByProperty(params: {
  propertyId: number;
  statusFilter: string | null;
  page: number;
  limit: number;
}): Promise<{
  data: ReturnType<typeof mapAdminNegotiation>[];
  page: number;
  limit: number;
  total: number;
  propertyId: number;
}> {
  const { propertyId, statusFilter, page, limit } = params;
  const offset = (page - 1) * limit;
  const { clause, params: clauseParams } = buildNegotiationStatusClause(statusFilter ?? 'UNDER_REVIEW');
  const clientSql = await resolveNegotiationClientSqlFragments();
  const timeSql = await resolveNegotiationTimeSqlFragments();

  const [countRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      WHERE n.property_id = ?
      ${clause}
    `,
    [propertyId, ...clauseParams]
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await adminDb.query<AdminNegotiationListRow[]>(
    `
      SELECT
        n.id,
        n.status AS negotiation_status,
        n.property_id,
        ${timeSql.nEventAtSelect} AS created_at,
        n.capturing_broker_id,
        n.selling_broker_id,
        n.seller_client_id,
        p.status AS property_status,
        p.code AS property_code,
        p.title AS property_title,
        CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
        COALESCE(NULLIF(p.price_sale, 0), NULLIF(p.price_rent, 0), NULLIF(p.price, 0)) AS property_value,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = n.property_id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image_url,
        n.final_value,
        n.proposal_validity_date,
        capture_user.name AS capturing_broker_name,
        seller_user.name AS selling_broker_name,
        seller_client_user.name AS seller_client_name,
        ${clientSql.clientName} AS client_name,
        ${clientSql.clientCpf} AS client_cpf,
        ${clientSql.paymentDinheiro} AS payment_dinheiro,
        ${clientSql.paymentPermuta} AS payment_permuta,
        ${clientSql.paymentFinanciamento} AS payment_financiamento,
        ${clientSql.paymentOutros} AS payment_outros,
        ${timeSql.nEventAtSelect} AS last_event_at,
        NULL AS approved_at,
        signed_doc.id AS signed_document_id,
        signed_doc.metadata_json AS signed_document_metadata_json,
        draft_doc.id AS draft_document_id,
        draft_doc.metadata_json AS draft_document_metadata_json
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
      LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
      LEFT JOIN users seller_client_user ON seller_client_user.id = n.seller_client_id
      LEFT JOIN (
        SELECT
          d.negotiation_id,
          d.id,
          d.metadata_json
        FROM negotiation_documents d
        INNER JOIN (
          SELECT negotiation_id, MAX(id) AS max_id
          FROM negotiation_documents
          WHERE type = 'other'
            AND document_type = 'contrato_assinado'
          GROUP BY negotiation_id
        ) dm ON dm.negotiation_id = d.negotiation_id AND d.id = dm.max_id
      ) signed_doc ON signed_doc.negotiation_id = n.id
      LEFT JOIN (
        SELECT
          d.negotiation_id,
          d.id,
          d.metadata_json
        FROM negotiation_documents d
        INNER JOIN (
          SELECT negotiation_id, MAX(id) AS max_id
          FROM negotiation_documents
          WHERE type = 'proposal'
            AND document_type = 'contrato_minuta'
          GROUP BY negotiation_id
        ) dm ON dm.negotiation_id = d.negotiation_id AND d.id = dm.max_id
      ) draft_doc ON draft_doc.negotiation_id = n.id
      WHERE n.property_id = ?
      ${clause}
      ORDER BY COALESCE(n.final_value, 0) DESC, ${timeSql.nEventSort} DESC, n.id DESC
      LIMIT ? OFFSET ?
    `,
    [propertyId, ...clauseParams, limit, offset]
  );

  return {
    data: rows.map(mapAdminNegotiation),
    page,
    limit,
    total,
    propertyId,
  };
}
