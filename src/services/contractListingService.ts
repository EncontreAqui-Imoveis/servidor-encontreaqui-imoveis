import { Request } from 'express';
import { RowDataPacket } from 'mysql2';
import type { AuthRequest } from '../middlewares/auth';
import { queryContractRows } from './contractPersistenceService';
import {
  CONTRACT_SELECT_BASE_SQL,
  buildContractDocumentProgress,
  buildContractDocumentRuleContextFromRow,
  mapContract,
  mapDocument,
  parseContractStatusFilter,
  type ContractDocumentListRow,
  type ContractRow,
} from '../controllers/ContractController';

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

  const statusFilter = parseContractStatusFilter(req.query.status);
  if (req.query.status != null && statusFilter == null) {
    throw new Error('Status de contrato inválido.');
  }

  const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const statusClause = statusFilter ? 'AND c.status = ?' : '';
  const statusParams = statusFilter ? [statusFilter] : [];

  const contractSelectSql = await getContractSelectSql();
  const countRows = await queryContractRows<RowDataPacket>(
    `
      SELECT COUNT(*) AS total
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ? OR n.seller_client_id = ? OR n.buyer_client_id = ?)
        AND COALESCE(c.seller_approval_status, '') <> 'REJECTED'
        AND COALESCE(c.buyer_approval_status, '') <> 'REJECTED'
      ${statusClause}
    `,
    [userId, userId, userId, userId, ...statusParams],
  );
  const total = Number(countRows[0]?.total ?? 0);

  const rows = await queryContractRows<ContractRow>(
    `
      ${contractSelectSql}
      WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ? OR n.seller_client_id = ? OR n.buyer_client_id = ?)
        AND COALESCE(c.seller_approval_status, '') <> 'REJECTED'
        AND COALESCE(c.buyer_approval_status, '') <> 'REJECTED'
      ${statusClause}
      ORDER BY c.updated_at DESC, c.created_at DESC
      LIMIT ? OFFSET ?
    `,
    [userId, userId, userId, userId, ...statusParams, limit, offset],
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
      ...mapContract(row, req),
      documentProgress: buildContractDocumentProgress(
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

async function getContractSelectSql(): Promise<string> {
  const hasTable = await queryContractRows<RowDataPacket>(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiation_responsibles'
      LIMIT 1
    `,
    [],
  );

  const responsibleUsersSelect = hasTable.length > 0
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      WHERE nr.negotiation_id = c.negotiation_id
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';

  return CONTRACT_SELECT_BASE_SQL.replace('__RESPONSIBLE_USERS_SELECT__', responsibleUsersSelect);
}
