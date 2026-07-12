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

export type ContractDataSide = 'seller' | 'buyer';

interface ContractPartyQualificationBase {
  estado_civil?: string;
  estadoCivil?: string;
  profissao?: string;
  regime_bens?: string;
  regimeBens?: string;
  conjuge_nome?: string;
  conjugeNome?: string;
  conjuge_cpf?: string;
  conjugeCpf?: string;
  conjuge_profissao?: string;
  conjugeProfissao?: string;
  spouse_name?: string;
  spouseName?: string;
  spouse_cpf?: string;
  spouseCpf?: string;
  spouse_profession?: string;
  spouseProfession?: string;
}

export interface SellerQualification extends ContractPartyQualificationBase {
  nome?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  telefone?: string;
  phone?: string;
  email?: string;
  cpf?: string;
  dados_bancarios?: string;
  dadosBancarios?: string;
}

export interface BuyerQualification extends ContractPartyQualificationBase {
  nome?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  clientName?: string;
  telefone?: string;
  phone?: string;
  email?: string;
  cpf?: string;
  clientCpf?: string;
  garantia_locacao?: string;
  garantiaLocacao?: string;
}

const SELLER_QUALIFICATION_KEYS = new Set<keyof SellerQualification>([
  'nome',
  'name',
  'fullName',
  'full_name',
  'telefone',
  'phone',
  'email',
  'cpf',
  'estado_civil',
  'estadoCivil',
  'profissao',
  'dados_bancarios',
  'dadosBancarios',
  'regime_bens',
  'regimeBens',
  'conjuge_nome',
  'conjugeNome',
  'conjuge_cpf',
  'conjugeCpf',
  'conjuge_profissao',
  'conjugeProfissao',
  'spouse_name',
  'spouseName',
  'spouse_cpf',
  'spouseCpf',
  'spouse_profession',
  'spouseProfession',
]);

const BUYER_QUALIFICATION_KEYS = new Set<keyof BuyerQualification>([
  'nome',
  'name',
  'fullName',
  'full_name',
  'clientName',
  'telefone',
  'phone',
  'email',
  'cpf',
  'clientCpf',
  'estado_civil',
  'estadoCivil',
  'profissao',
  'regime_bens',
  'regimeBens',
  'conjuge_nome',
  'conjugeNome',
  'conjuge_cpf',
  'conjugeCpf',
  'conjuge_profissao',
  'conjugeProfissao',
  'spouse_name',
  'spouseName',
  'spouse_cpf',
  'spouseCpf',
  'spouse_profession',
  'spouseProfession',
  'garantia_locacao',
  'garantiaLocacao',
]);

export interface ContractDataUpdateBody {
  ownerInfo?: unknown;
  owner_info?: unknown;
  sellerInfo?: unknown;
  seller_info?: unknown;
  buyerInfo?: unknown;
  buyer_info?: unknown;
  side?: unknown;
}

function declaresOppositeParty(key: string, side: ContractDataSide): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const oppositePrefixes =
    side === 'seller' ? ['buyer', 'comprador'] : ['seller', 'owner', 'anunciante', 'vendedor'];
  return oppositePrefixes.some((prefix) => normalized.startsWith(prefix));
}

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
  side: ContractDataSide,
  fieldName: string
): void {
  const blockedKeys = side === 'seller' ? SELLER_BLOCK_KEYS : BUYER_BLOCK_KEYS;
  for (const [key, nested] of Object.entries(value)) {
    if (blockedKeys.has(key) || declaresOppositeParty(key, side)) {
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

function validateQualificationAllowlist(
  value: Record<string, unknown>,
  side: ContractDataSide,
  fieldName: string
): void {
  const allowedKeys: ReadonlySet<string> =
    side === 'seller' ? SELLER_QUALIFICATION_KEYS : BUYER_QUALIFICATION_KEYS;
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      throw mutationError(400, `${fieldName}.${key} não é permitido para o lado ${side}.`);
    }
    if (fieldValue !== null && typeof fieldValue !== 'string') {
      throw mutationError(400, `${fieldName}.${key} deve ser texto ou nulo.`);
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

function parseDataSide(value: unknown): ContractDataSide | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'seller' || normalized === 'buyer' ? normalized : null;
}

function readNonEmptyText(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function mergeQualification(
  stored: Record<string, unknown>,
  patch: Record<string, unknown> | null
): Record<string, unknown> {
  return patch ? { ...stored, ...patch } : { ...stored };
}

function requiresSpouse(civilStatus: unknown): boolean {
  const normalized = String(civilStatus ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  return normalized.includes('casad') || (normalized.includes('uniao') && normalized.includes('estav'));
}

function normalizeSpouseQualification(
  qualification: Record<string, unknown>,
  fieldName: string
): Record<string, unknown> {
  const civilStatus = qualification.estado_civil ?? qualification.estadoCivil;
  const spouseFields = [
    ['conjuge_nome', ['conjuge_nome', 'conjugeNome', 'spouse_name', 'spouseName']],
    ['conjuge_cpf', ['conjuge_cpf', 'conjugeCpf', 'spouse_cpf', 'spouseCpf']],
    ['conjuge_profissao', ['conjuge_profissao', 'conjugeProfissao', 'spouse_profession', 'spouseProfession']],
  ] as const;

  if (requiresSpouse(civilStatus)) {
    const normalized = { ...qualification };
    for (const [canonicalKey, aliases] of spouseFields) {
      const value = readNonEmptyText(normalized, aliases);
      if (!value) {
        throw mutationError(
          400,
          `${fieldName}.${canonicalKey} é obrigatório para Casado(a) ou União Estável.`
        );
      }
      normalized[canonicalKey] = value;
    }
    return normalized;
  }

  const normalized = { ...qualification };
  for (const [canonicalKey, aliases] of spouseFields) {
    for (const alias of aliases) {
      if (alias !== canonicalKey) delete normalized[alias];
    }
    normalized[canonicalKey] = null;
  }
  return normalized;
}

function inheritPartyIdentity(
  contract: ContractRow,
  side: ContractDataSide,
  qualification: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...qualification };
  const identityKeys =
    side === 'seller'
      ? ['nome', 'name', 'fullName', 'full_name']
      : ['nome', 'name', 'fullName', 'full_name', 'clientName'];
  const cpfKeys = side === 'seller' ? ['cpf'] : ['cpf', 'clientCpf'];
  const inheritedName = side === 'seller' ? contract.property_owner_name : contract.client_name;
  const inheritedCpf = side === 'seller' ? contract.seller_cpf : contract.buyer_cpf;

  const name = readNonEmptyText(normalized, identityKeys) ?? String(inheritedName ?? '').trim();
  const cpf = readNonEmptyText(normalized, cpfKeys) ?? String(inheritedCpf ?? '').trim();

  if (name) normalized.nome = name;
  if (cpf) normalized.cpf = cpf;

  return normalized;
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
    body: ContractDataUpdateBody;
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
    validateQualificationAllowlist(sellerPatch, side, 'sellerInfo');
  }
  if (side === 'buyer' && buyerPatch) {
    rejectCrossSideBlocks(buyerPatch, side, 'buyerInfo');
    validateQualificationAllowlist(buyerPatch, side, 'buyerInfo');
  }

  const contract = await fetchContractForUpdate(tx, params.contractId);
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  const context = resolveContractAccessContext(
    { id: params.req.userId, role: params.req.userRole },
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

  const nextSellerInfo =
    side === 'seller'
      ? normalizeSpouseQualification(
          inheritPartyIdentity(contract, 'seller', mergeQualification(sellerInfo, sellerPatch)),
          'sellerInfo'
        )
      : sellerInfo;
  const nextBuyerInfo =
    side === 'buyer'
      ? normalizeSpouseQualification(
          inheritPartyIdentity(contract, 'buyer', mergeQualification(buyerInfo, buyerPatch)),
          'buyerInfo'
        )
      : buyerInfo;

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
