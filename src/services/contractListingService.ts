import { Request } from 'express';
import { RowDataPacket } from 'mysql2';
import type { AuthRequest } from '../middlewares/auth';
import { queryContractRows } from './contractPersistenceService';
import {
  CONTRACT_SELECT_BASE_SQL,
  buildContractDocumentProgress,
  buildEmptyContractDocumentProgress,
  buildContractDocumentRuleContextFromRow,
  mapContract,
  mapDocument,
  parseContractStatusFilter,
  type ContractDocumentListRow,
  type ContractRow,
} from '../controllers/ContractController';
import { resolveContractAccessContext } from '../utils/contractAccessResolver';

function buildDocumentsByNegotiation(documentRows: ContractDocumentListRow[]) {
  const documentsByNegotiation = new Map<string, ContractDocumentListRow[]>();
  for (const row of documentRows) {
    const negotiationId = String(row.negotiation_id);
    const docs = documentsByNegotiation.get(negotiationId) ?? [];
    docs.push(row);
    documentsByNegotiation.set(negotiationId, docs);
  }
  return documentsByNegotiation;
}

function parseAdminSearchTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 120);
  return normalized.length > 0 ? normalized.toLocaleLowerCase('pt-BR') : null;
}

function buildAdminContractWhere(
  statusFilter: string | null,
  searchTerm: string | null,
): { clause: string; params: Array<string> } {
  const clauses: string[] = [];
  const params: string[] = [];

  if (statusFilter) {
    clauses.push('c.status = ?');
    params.push(statusFilter);
  }

  if (searchTerm) {
    // Keep the public property code and legally resolved party names searchable
    // without exposing an internal contract id in the panel UI.
    clauses.push(`
      LOWER(CONCAT_WS(' ',
        COALESCE(p.public_code, ''),
        COALESCE(p.code, ''),
        COALESCE(p.title, ''),
        COALESCE(owner_user.name, ''),
        COALESCE(advertiser_user.name, ''),
        COALESCE(proposer_user.name, ''),
        COALESCE(legal_buyer_user.name, ''),
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.seller_info, '$.nome')), ''),
        COALESCE(JSON_UNQUOTE(JSON_EXTRACT(c.buyer_info, '$.nome')), '')
      )) LIKE ?
    `);
    params.push(`%${searchTerm}%`);
  }

  return {
    clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

export async function listContractsForAdmin(
  req: Request,
): Promise<{
  data: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
}> {
  const statusFilter = parseContractStatusFilter(req.query.status);
  if (req.query.status != null && statusFilter == null) {
    throw new Error('Status de contrato inválido.');
  }

  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const searchTerm = parseAdminSearchTerm(req.query.search);
  const { clause: whereClause, params: whereParams } = buildAdminContractWhere(
    statusFilter,
    searchTerm,
  );

  const contractSelectSql = await getContractSelectSql();
  const countRows = await queryContractRows<RowDataPacket>(
    `
      SELECT COUNT(*) AS total
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      JOIN properties p ON p.id = c.property_id
      LEFT JOIN users proposer_user ON proposer_user.id = n.proposer_id
      LEFT JOIN users legal_buyer_user ON legal_buyer_user.id = n.legal_buyer_user_id
      LEFT JOIN users advertiser_user ON advertiser_user.id = n.advertiser_id
      LEFT JOIN users owner_user ON owner_user.id = p.owner_id
      ${whereClause}
    `,
    whereParams,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const rows = await queryContractRows<ContractRow>(
    `
      ${contractSelectSql}
      ${whereClause}
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT ? OFFSET ?
    `,
    [...whereParams, limit, offset],
  );

  if (rows.length === 0) {
    return { data: [], total, page, limit };
  }

  const negotiationIds = rows.map((row) => row.negotiation_id);
  const placeholders = negotiationIds.map(() => '?').join(', ');
  const documentRows = await queryContractRows<ContractDocumentListRow>(
    `
      SELECT id, negotiation_id, type, document_type, metadata_json, created_at
      FROM negotiation_documents
      WHERE negotiation_id IN (${placeholders})
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
        AND UPPER(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
          'APPROVED'
        )) <> 'REJECTED'
      ORDER BY created_at DESC, id DESC
    `,
    negotiationIds,
  );

  const documentsByNegotiation = buildDocumentsByNegotiation(documentRows);
  return {
    data: rows.map((row) => ({
      ...mapContract(row, req as AuthRequest),
      documents: (documentsByNegotiation.get(row.negotiation_id) ?? []).map((documentRow) => ({
        ...mapDocument(documentRow),
        downloadUrl: `/negotiations/${row.negotiation_id}/documents/${documentRow.id}/download`,
      })),
    })),
    total,
    page,
    limit,
  };
}

export async function listMyContractsForUser(
  req: AuthRequest,
): Promise<{
  data: Array<Record<string, unknown>>;
  total: number;
  page: number;
  limit: number;
}> {
  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('Usuário não autenticado.');
  }

  if (String(req.userRole ?? '').trim().toLowerCase() === 'admin') {
    return listContractsForAdmin(req);
  }

  const statusFilter = parseContractStatusFilter(req.query.status);
  if (req.query.status != null && statusFilter == null) {
    throw new Error('Status de contrato inválido.');
  }

  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
  const offset = (page - 1) * limit;

  // Cancelled contracts remain auditable through the admin route only. A
  // participant must not see stale contract actions in the mobile listing.
  const statusClause = statusFilter ? 'AND c.status = ?' : '';
  const statusParams = statusFilter ? [statusFilter] : [];
  const activeContractClause = "AND UPPER(TRIM(COALESCE(c.status, ''))) <> 'CANCELLED'";

  const contractSelectSql = await getContractSelectSql();
  const includeResponsibles = await hasNegotiationResponsiblesTable();
  const responsibleVisibilityClause = includeResponsibles
    ? `
        OR EXISTS (
          SELECT 1
          FROM negotiation_responsibles nr
          JOIN brokers responsible_broker ON responsible_broker.id = nr.user_id
          WHERE nr.negotiation_id = c.negotiation_id
            AND nr.user_id = ?
            AND responsible_broker.status = 'approved'
            AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
        )`
    : '';
  const visibilityClause = `
      (
        n.advertiser_id = ?
        OR p.owner_id = ?
        OR p.broker_id = ?
        OR n.capturing_broker_id = ?
        OR n.selling_broker_id = ?
        OR c.selling_broker_id = ?
        OR n.proposer_id = ?
        OR n.legal_buyer_user_id = ?
        ${responsibleVisibilityClause}
      )
  `;
  const baseVisibilityParams = [userId, userId, userId, userId, userId, userId, userId, userId];
  const visibilityParams = includeResponsibles
    ? [...baseVisibilityParams, userId]
    : baseVisibilityParams;
  const countRows = await queryContractRows<RowDataPacket>(
    `
      SELECT COUNT(*) AS total
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      JOIN properties p ON p.id = c.property_id
      WHERE ${visibilityClause}
      ${activeContractClause}
      ${statusClause}
    `,
    [...visibilityParams, ...statusParams],
  );
  const total = Number(countRows[0]?.total ?? 0);

  const rows = await queryContractRows<ContractRow>(
    `
      ${contractSelectSql}
      WHERE ${visibilityClause}
      ${activeContractClause}
      ${statusClause}
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT ? OFFSET ?
    `,
    [...visibilityParams, ...statusParams, limit, offset],
  );

  // SQL narrows candidates for pagination. The resolver remains the single
  // authorization source and removes ambiguous or otherwise invalid matches.
  const readableRows = rows.filter(
    (row) => resolveContractAccessContext({ id: req.userId, role: req.userRole }, row).canReadMeta,
  );

  if (readableRows.length === 0) {
    return { data: [], total: 0, page, limit };
  }

  const negotiationIds = readableRows.map((row) => row.negotiation_id);
  const placeholders = negotiationIds.map(() => '?').join(', ');
  const documentRows = await queryContractRows<ContractDocumentListRow>(
    `
      SELECT id, negotiation_id, type, document_type, metadata_json, created_at
      FROM negotiation_documents
      WHERE negotiation_id IN (${placeholders})
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
        AND UPPER(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
          'APPROVED'
        )) <> 'REJECTED'
      ORDER BY created_at DESC, id DESC
    `,
    negotiationIds,
  );

  const documentsByNegotiation = buildDocumentsByNegotiation(documentRows);
  return {
    data: readableRows.map((row) => ({
      ...mapContract(row, req),
      documentProgress: resolveContractAccessContext(
        { id: req.userId, role: req.userRole },
        row
      ).requiresHandshakeVerification
        ? buildEmptyContractDocumentProgress()
        : buildContractDocumentProgress(
            (documentsByNegotiation.get(row.negotiation_id) ?? []).map((doc) => {
              const mapped = mapDocument(doc);
              return {
                ...mapped,
                metadata: mapped.metadata as Record<string, unknown>,
              };
            }),
            buildContractDocumentRuleContextFromRow(row),
          ),
    })),
    total,
    page,
    limit,
  };
}

export type ContractHubCounters = {
  proposals_active_count: number;
  contracts_pending_documents_count: number;
};

/**
 * Returns compact, actor-scoped counters for the mobile "Meus Processos" hub.
 * The document count intentionally reuses the contract requirement matrix so a
 * missing required upload is counted even when no document row exists yet.
 */
export async function getContractHubCounters(
  req: AuthRequest,
): Promise<ContractHubCounters> {
  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('Usuário não autenticado.');
  }

  const isAdmin = String(req.userRole ?? '').trim().toLowerCase() === 'admin';
  const proposalVisibilityClause = isAdmin
    ? '1 = 1'
    : '(n.proposer_id = ? OR n.advertiser_id = ? OR p.owner_id = ?)';
  const proposalVisibilityParams = isAdmin ? [] : [userId, userId, userId];
  const proposalCountRows = await queryContractRows<RowDataPacket>(
    `
      SELECT COUNT(DISTINCT n.id) AS total
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN contracts c ON c.negotiation_id = n.id
      WHERE ${proposalVisibilityClause}
        AND c.id IS NULL
        AND UPPER(TRIM(COALESCE(n.status, ''))) NOT IN (
          'CANCELLED', 'REFUSED', 'REJECTED', 'EXPIRED', 'SOLD', 'RENTED', 'CONCLUDED'
        )
    `,
    proposalVisibilityParams,
  );
  const proposalsActiveCount = Number(proposalCountRows[0]?.total ?? 0);

  const includeResponsibles = await hasNegotiationResponsiblesTable();
  const responsibleVisibilityClause = includeResponsibles
    ? `
        OR EXISTS (
          SELECT 1
          FROM negotiation_responsibles nr
          JOIN brokers responsible_broker ON responsible_broker.id = nr.user_id
          WHERE nr.negotiation_id = c.negotiation_id
            AND nr.user_id = ?
            AND responsible_broker.status = 'approved'
            AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
        )`
    : '';
  const contractVisibilityClause = isAdmin
    ? '1 = 1'
    : `
      (
        n.advertiser_id = ?
        OR p.owner_id = ?
        OR n.proposer_id = ?
        OR n.legal_buyer_user_id = ?
        ${responsibleVisibilityClause}
      )
    `;
  const contractVisibilityParams = isAdmin
    ? []
    : includeResponsibles
      ? [userId, userId, userId, userId, userId]
      : [userId, userId, userId, userId];
  const contractSelectSql = await getContractSelectSql();
  const contractRows = await queryContractRows<ContractRow>(
    `
      ${contractSelectSql}
      WHERE ${contractVisibilityClause}
        AND UPPER(TRIM(COALESCE(c.status, ''))) <> 'CANCELLED'
      ORDER BY c.updated_at DESC, c.created_at DESC
    `,
    contractVisibilityParams,
  );

  const readableContracts = contractRows.filter((contract) => {
    const access = resolveContractAccessContext(
      { id: req.userId, role: req.userRole },
      contract,
    );
    return access.canReadMeta && !access.requiresHandshakeVerification;
  });
  if (readableContracts.length === 0) {
    return {
      proposals_active_count: proposalsActiveCount,
      contracts_pending_documents_count: 0,
    };
  }

  const negotiationIds = readableContracts.map((contract) => contract.negotiation_id);
  const placeholders = negotiationIds.map(() => '?').join(', ');
  const documentRows = await queryContractRows<ContractDocumentListRow>(
    `
      SELECT id, negotiation_id, type, document_type, metadata_json, created_at
      FROM negotiation_documents
      WHERE negotiation_id IN (${placeholders})
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
        AND UPPER(COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
          'APPROVED'
        )) <> 'REJECTED'
      ORDER BY created_at DESC, id DESC
    `,
    negotiationIds,
  );
  const documentsByNegotiation = buildDocumentsByNegotiation(documentRows);
  const contractsPendingDocumentsCount = readableContracts.reduce((total, contract) => {
    const access = resolveContractAccessContext(
      { id: req.userId, role: req.userRole },
      contract,
    );
    const progress = buildContractDocumentProgress(
      (documentsByNegotiation.get(contract.negotiation_id) ?? []).map((document) => {
        const mapped = mapDocument(document);
        return { ...mapped, metadata: mapped.metadata as Record<string, unknown> };
      }),
      buildContractDocumentRuleContextFromRow(contract),
    );
    const hasPendingDocuments =
      access.userRole === 'buyer'
        ? progress.buyer.totals.pending > 0
        : access.userRole === 'seller'
          ? progress.seller.totals.pending > 0
          : progress.seller.totals.pending > 0 || progress.buyer.totals.pending > 0;
    return total + (hasPendingDocuments ? 1 : 0);
  }, 0);

  return {
    proposals_active_count: proposalsActiveCount,
    contracts_pending_documents_count: contractsPendingDocumentsCount,
  };
}

let negotiationResponsiblesTableCache: boolean | null = null;

async function hasNegotiationResponsiblesTable(): Promise<boolean> {
  if (negotiationResponsiblesTableCache != null) {
    return negotiationResponsiblesTableCache;
  }

  const rows = await queryContractRows<RowDataPacket>(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiation_responsibles'
      LIMIT 1
    `,
    [],
  );
  negotiationResponsiblesTableCache = rows.length > 0;
  return negotiationResponsiblesTableCache;
}

async function getContractSelectSql(): Promise<string> {
  const hasTable = await hasNegotiationResponsiblesTable();
  const responsibleUsersSelect = hasTable
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      JOIN brokers responsible_broker ON responsible_broker.id = nr.user_id
      WHERE nr.negotiation_id = c.negotiation_id
        AND responsible_broker.status = 'approved'
        AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';

  return CONTRACT_SELECT_BASE_SQL.replace('__RESPONSIBLE_USERS_SELECT__', responsibleUsersSelect);
}
