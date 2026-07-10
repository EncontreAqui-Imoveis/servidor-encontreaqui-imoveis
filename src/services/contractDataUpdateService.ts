import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  CONTRACT_SELECT_BASE_SQL,
  type ContractRow,
} from '../controllers/ContractController';
import { resolveContractAccessContext } from '../utils/contractAccessResolver';

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

const JSON_BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const SELLER_BLOCK_KEYS = new Set(['buyerInfo', 'buyer_info']);
const BUYER_BLOCK_KEYS = new Set([
  'sellerInfo',
  'seller_info',
  'ownerInfo',
  'owner_info',
]);

function sanitizeJsonValue(value: unknown, fieldName: string): unknown {
  if (value === undefined) {
    throw new Error(`${fieldName} contém um valor inválido.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${fieldName} contém um número inválido.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeJsonValue(item, `${fieldName}[${index}]`));
  }
  if (typeof value !== 'object') {
    throw new Error(`${fieldName} contém um valor JSON inválido.`);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (JSON_BLOCKED_KEYS.has(key)) {
      throw new Error(`${fieldName} contém uma chave não permitida.`);
    }
    sanitized[key] = sanitizeJsonValue(item, `${fieldName}.${key}`);
  }
  return sanitized;
}

function rejectCrossSideBlocks(
  value: Record<string, unknown>,
  side: 'seller' | 'buyer',
  fieldName: string
): void {
  const blockedKeys = side === 'seller' ? SELLER_BLOCK_KEYS : BUYER_BLOCK_KEYS;
  for (const [key, nested] of Object.entries(value)) {
    if (blockedKeys.has(key)) {
      throw mutationError(
        400,
        `${fieldName} não pode conter dados do lado ${side === 'seller' ? 'comprador' : 'vendedor'}.`
      );
    }
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      rejectCrossSideBlocks(nested as Record<string, unknown>, side, `${fieldName}.${key}`);
    }
  }
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
      return sanitizeJsonValue(parsed, fieldName) as Record<string, unknown>;
    } catch {
      throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
  }

  return sanitizeJsonValue(value, fieldName) as Record<string, unknown>;
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

function parseDataSide(value: unknown): 'seller' | 'buyer' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'seller' || normalized === 'buyer' ? normalized : null;
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
      side?: unknown;
    };
  }
): Promise<{ contract: ContractRow | null }> {
  let sellerPatch: Record<string, unknown> | null = null;
  let buyerPatch: Record<string, unknown> | null = null;

  try {
    sellerPatch = normalizeJsonObject(
      params.body.ownerInfo ?? params.body.owner_info ?? params.body.sellerInfo ?? params.body.seller_info,
      'sellerInfo',
      { emptyStringAsNull: true }
    );
    buyerPatch = normalizeJsonObject(params.body.buyerInfo ?? params.body.buyer_info, 'buyerInfo', {
      emptyStringAsNull: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Payload inválido.';
    throw mutationError(400, message);
  }

  if (!sellerPatch && !buyerPatch) {
    throw mutationError(400, 'Informe sellerInfo ou buyerInfo para atualização.');
  }

  const side = parseDataSide(params.body.side);
  if (!side) {
    throw mutationError(400, 'Informe o lado da atualização (side: seller|buyer).');
  }
  if (sellerPatch && buyerPatch) {
    throw mutationError(400, 'Atualize apenas um lado por requisição.');
  }
  if (side === 'seller' && !sellerPatch) {
    throw mutationError(400, 'side seller exige sellerInfo.');
  }
  if (side === 'buyer' && !buyerPatch) {
    throw mutationError(400, 'side buyer exige buyerInfo.');
  }
  if (side === 'seller' && sellerPatch) {
    rejectCrossSideBlocks(sellerPatch, side, 'sellerInfo');
  }
  if (side === 'buyer' && buyerPatch) {
    rejectCrossSideBlocks(buyerPatch, side, 'buyerInfo');
  }

  const contract = await fetchContractForUpdate(tx, params.contractId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  const context = resolveContractAccessContext(
    { id: params.req.userId, role: params.req.userRole, cpf: params.req.userCpf },
    contract
  );
  params.req.contractContext = context;
  if (context.userRole === 'none') {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }

  if (side === 'seller' && !context.canEditSeller) {
    throw mutationError(403, 'Seu acesso não permite editar o lado vendedor nesta etapa.');
  }

  if (side === 'buyer' && !context.canEditBuyer) {
    throw mutationError(403, 'Seu acesso não permite editar o lado comprador nesta etapa.');
  }

  const sellerInfo = parseStoredJsonObject(contract.seller_info);
  const buyerInfo = parseStoredJsonObject(contract.buyer_info);

  const nextSellerInfo = sellerPatch ?? sellerInfo;
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
    [JSON.stringify(nextSellerInfo), JSON.stringify(nextBuyerInfo), params.contractId]
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
