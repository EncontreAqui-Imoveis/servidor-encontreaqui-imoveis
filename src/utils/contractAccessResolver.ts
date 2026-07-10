import type { ContractAccessContext, ContractRole } from '../types/contractAuth';
import { normalizeCpfDigits } from './cpfValidator';

export interface ContractAccessUser {
  id: number | string | null | undefined;
  role: string | null | undefined;
  cpf?: string | null;
}

export interface ContractAccessRecord {
  id: string;
  status: string | null | undefined;
  seller_client_id: number | string | null | undefined;
  buyer_client_id: number | string | null | undefined;
  seller_cpf?: string | null;
  buyer_cpf?: string | null;
  client_cpf?: string | null;
  responsible_user_ids?: readonly number[] | string | null;
}

function normalizePositiveId(value: unknown): string | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function sameCpf(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeCpfDigits(String(left ?? ''));
  const normalizedRight = normalizeCpfDigits(String(right ?? ''));
  return normalizedLeft.length === 11 && normalizedLeft === normalizedRight;
}

function responsibleIds(value: ContractAccessRecord['responsible_user_ids']): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.map(normalizePositiveId).filter((id): id is string => id != null));
  }

  return new Set(
    String(value ?? '')
      .split(',')
      .map((id) => normalizePositiveId(id.trim()))
      .filter((id): id is string => id != null)
  );
}

function buildContext(
  contractId: string,
  userId: string,
  userRole: ContractRole,
  editable: boolean
): ContractAccessContext {
  const canReadMeta = userRole !== 'none';
  const canReadSeller = userRole === 'seller' || userRole === 'responsible' || userRole === 'admin';
  const canReadBuyer = userRole === 'buyer' || userRole === 'responsible' || userRole === 'admin';

  return {
    contractId,
    userId,
    userRole,
    canReadMeta,
    canReadSeller,
    canEditSeller: editable && canReadSeller,
    canReadBuyer,
    canEditBuyer: editable && canReadBuyer,
  };
}

/**
 * Pure authorization decision for one contract. Never infer access from captor,
 * selling broker, or proposal creator.
 */
export function resolveContractAccessContext(
  user: ContractAccessUser,
  contract: ContractAccessRecord
): ContractAccessContext {
  const contractId = String(contract.id ?? '').trim();
  const userId = normalizePositiveId(user.id) ?? '';
  if (!contractId || !userId) {
    return buildContext(contractId, userId, 'none', false);
  }

  const requestRole = String(user.role ?? '').trim().toLowerCase();
  const sellerId = normalizePositiveId(contract.seller_client_id);
  const buyerId = normalizePositiveId(contract.buyer_client_id);
  const sellerCpf = contract.seller_cpf ?? null;
  const buyerCpf = contract.buyer_cpf ?? contract.client_cpf ?? null;
  const hasDualIdentity =
    (sellerId != null && buyerId != null && sellerId === buyerId) || sameCpf(sellerCpf, buyerCpf);

  // Admin keeps operational access so duplicate identities can be repaired.
  if (requestRole === 'admin') {
    return buildContext(contractId, userId, 'admin', true);
  }

  // A duplicated participant identity must be repaired by an admin, never inferred.
  if (hasDualIdentity) {
    return buildContext(contractId, userId, 'none', false);
  }

  let role: ContractRole = 'none';
  if (responsibleIds(contract.responsible_user_ids).has(userId)) {
    role = 'responsible';
  } else if (sellerId === userId) {
    role = 'seller';
  } else if (buyerId === userId || sameCpf(user.cpf, buyerCpf)) {
    role = 'buyer';
  }

  const status = String(contract.status ?? '').trim().toUpperCase();
  const workflowFrozen = status === 'FINALIZED' || status === 'AWAITING_SIGNATURES';
  return buildContext(contractId, userId, role, role !== 'none' && !workflowFrozen);
}
