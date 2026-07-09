import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  CONTRACT_SELECT_BASE_SQL,
  type ContractRow,
} from '../controllers/ContractController';
import { resolveContractAccessContext } from '../utils/contractIdentity';

class ContractDataUpdateError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mutationError(statusCode: number, message: string): ContractDataUpdateError {
  return new ContractDataUpdateError(statusCode, message);
}

function normalizeJsonObject(
  value: unknown,
  fieldName: string,
  options?: { emptyStringAsNull?: boolean }
): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      if (options?.emptyStringAsNull) {
        return null;
      }
      throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
  }

  return value as Record<string, unknown>;
}

function parseStoredJsonObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function resolveApprovalStatus(value: unknown): 'PENDING' | 'APPROVED' | 'REJECTED' {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'APPROVED'
    ? 'APPROVED'
    : normalized === 'REJECTED'
      ? 'REJECTED'
      : 'PENDING';
}

function approvalStatusAllowsEditing(status: 'PENDING' | 'APPROVED' | 'REJECTED'): boolean {
  return status === 'PENDING' || status === 'REJECTED';
}

function isNegotiationResponsibleUser(contract: ContractRow, userId: number): boolean {
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  const raw = String(contract.responsible_user_ids ?? '').trim();
  if (!raw) {
    return false;
  }
  return raw
    .split(',')
    .map((value) => Number(value))
    .some((value) => Number.isInteger(value) && value === userId);
}

function canAccessContract(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }

  const context = resolveContractAccessContext(
    req,
    contract,
    isNegotiationResponsibleUser(contract, userId) &&
      (role === 'broker' || role === 'auxiliary_administrative')
  );
  if (!context) {
    return false;
  }

  if (context.isAdmin || context.isResponsible) {
    return true;
  }

  if (context.role === 'client') {
    return context.isBuyerSide || context.isSellerSide;
  }

  return false;
}

function canEditSellerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  const context = resolveContractAccessContext(
    req,
    contract,
    isNegotiationResponsibleUser(contract, userId) &&
      (role === 'broker' || role === 'auxiliary_administrative')
  );
  if (!context) {
    return false;
  }

  if (context.isAdmin || context.isResponsible) {
    return true;
  }

  if (context.role === 'client') {
    return context.isSellerSide;
  }

  return false;
}

function canEditBuyerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  const context = resolveContractAccessContext(
    req,
    contract,
    isNegotiationResponsibleUser(contract, userId) &&
      (role === 'broker' || role === 'auxiliary_administrative')
  );
  if (!context) {
    return false;
  }

  if (context.isAdmin || context.isResponsible) {
    return true;
  }

  if (context.role === 'client') {
    return context.isBuyerSide;
  }

  return false;
}

async function fetchContractForUpdate(
  tx: PoolConnection,
  contractId: string
): Promise<ContractRow | null> {
  const includeResponsibles = await hasNegotiationResponsiblesTable(tx);
  const responsibleUsersSelect = includeResponsibles
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      WHERE nr.negotiation_id = c.negotiation_id
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';
  const contractSelectSql = CONTRACT_SELECT_BASE_SQL.replace(
    '__RESPONSIBLE_USERS_SELECT__',
    responsibleUsersSelect
  );
  const [rows] = await tx.query<ContractRow[]>(
    `
      ${contractSelectSql}
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

export async function updateContractData(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contractId: string;
    body: {
      ownerInfo?: unknown;
      owner_info?: unknown;
      sellerInfo?: unknown;
      seller_info?: unknown;
      buyerInfo?: unknown;
      buyer_info?: unknown;
    };
  }
): Promise<{ contract: ContractRow | null }> {
  let ownerPatch: Record<string, unknown> | null = null;
  let buyerPatch: Record<string, unknown> | null = null;

  try {
    ownerPatch = normalizeJsonObject(
      params.body.ownerInfo ?? params.body.owner_info ?? params.body.sellerInfo ?? params.body.seller_info,
      'ownerInfo',
      { emptyStringAsNull: true }
    );
    buyerPatch = normalizeJsonObject(params.body.buyerInfo ?? params.body.buyer_info, 'buyerInfo', {
      emptyStringAsNull: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payload inválido.';
    throw mutationError(400, message);
  }

  if (!ownerPatch && !buyerPatch) {
    throw mutationError(400, 'Informe ao menos ownerInfo ou buyerInfo para atualização.');
  }

  const contract = await fetchContractForUpdate(tx, params.contractId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  if (!canAccessContract(params.req, contract)) {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }

  const role = String(params.req.userRole ?? '').toLowerCase();
  const isAdmin = role === 'admin';
  const canEditSeller = canEditSellerSide(params.req, contract);
  const canEditBuyer = canEditBuyerSide(params.req, contract);

  if (ownerPatch && !canEditSeller) {
    throw mutationError(403, 'Somente o proprietário pode editar ownerInfo.');
  }

  if (buyerPatch && !canEditBuyer) {
    throw mutationError(403, 'Somente o comprador pode editar buyerInfo.');
  }

  const sellerStatus = resolveApprovalStatus(contract.seller_approval_status);
  const buyerStatus = resolveApprovalStatus(contract.buyer_approval_status);

  if (ownerPatch && !approvalStatusAllowsEditing(sellerStatus) && !isAdmin) {
    throw mutationError(403, 'Dados do lado owner não podem ser alterados após aprovação.');
  }

  if (buyerPatch && !approvalStatusAllowsEditing(buyerStatus) && !isAdmin) {
    throw mutationError(403, 'Dados do lado buyer não podem ser alterados após aprovação.');
  }

  const ownerInfo = parseStoredJsonObject(contract.seller_info);
  const buyerInfo = parseStoredJsonObject(contract.buyer_info);

  const nextOwnerInfo = ownerPatch ?? ownerInfo;
  const nextBuyerInfo = buyerPatch ?? buyerInfo;

  await tx.query(
    `
      UPDATE contracts
      SET
        seller_info = CAST(? AS JSON),
        buyer_info = CAST(? AS JSON),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(nextOwnerInfo), JSON.stringify(nextBuyerInfo), params.contractId]
  );

  return {
    contract: await fetchContractForUpdate(tx, params.contractId),
  };
}

export function isContractDataUpdateError(error: unknown): error is ContractDataUpdateError {
  return error instanceof ContractDataUpdateError;
}
let negotiationResponsiblesTableCache: boolean | null = null;

async function hasNegotiationResponsiblesTable(tx: PoolConnection): Promise<boolean> {
  if (negotiationResponsiblesTableCache != null) {
    return negotiationResponsiblesTableCache;
  }

  const [rows] = await tx.query<Array<RowDataPacket & { has_table: number }>>(
    `
      SELECT 1 AS has_table
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiation_responsibles'
      LIMIT 1
    `
  );
  negotiationResponsiblesTableCache = rows.length > 0;
  return negotiationResponsiblesTableCache;
}
