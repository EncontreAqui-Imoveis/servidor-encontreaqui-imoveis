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

  const whereClause = statusFilter ? 'WHERE c.status = ?' : '';
  const whereParams = statusFilter ? [statusFilter] : [];

  const contractSelectSql = await getContractSelectSql();
  const countRows = await queryContractRows<RowDataPacket>(
    `
      SELECT COUNT(*) AS total
      FROM contracts c
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
          WHERE nr.negotiation_id = c.negotiation_id
            AND nr.user_id = ?
        )`
    : '';
  const visibilityClause = `
      (
        n.advertiser_id = ?
        OR p.owner_id = ?
        OR n.proposer_id = ?
        OR n.legal_buyer_user_id = ?
        ${responsibleVisibilityClause}
      )
  `;
  const visibilityParams = includeResponsibles
    ? [userId, userId, userId, userId, userId]
    : [userId, userId, userId, userId];
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
      WHERE nr.negotiation_id = c.negotiation_id
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';

  return CONTRACT_SELECT_BASE_SQL.replace('__RESPONSIBLE_USERS_SELECT__', responsibleUsersSelect);
}
