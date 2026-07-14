import type { ContractAccessContext, ContractRole } from '../types/contractAuth';

export interface ContractAccessUser {
  id: number | string | null | undefined;
  role: string | null | undefined;
  /** Compatibility-only. Contract authorization never reads this field. */
  cpf?: string | null;
}

export interface ContractAccessRecord {
  id: string;
  status: string | null | undefined;
  advertiser_id: number | string | null | undefined;
  property_owner_id?: number | string | null;
  proposer_id: number | string | null | undefined;
  initiator_side?: 'buyer' | 'seller' | string | null;
  legal_buyer_user_id?: number | string | null;
  handshake_pin?: string | null;
  handshake_status?: 'PENDING' | 'VERIFIED' | 'REJECTED' | string | null;
  handshake_attempts?: number | string | null;
  responsible_user_ids?: readonly number[] | string | null;
}

function normalizePositiveId(value: unknown): string | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
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
  editable: boolean,
  workflowStatus: string,
  options: {
    requiresHandshakeVerification?: boolean;
    handshakeStatus?: ContractAccessContext['handshakeStatus'];
  } = {}
): ContractAccessContext {
  const canReadMeta = userRole !== 'none';
  const canReadSeller = userRole === 'seller' || userRole === 'responsible' || userRole === 'admin';
  const canReadBuyer = userRole === 'buyer' || userRole === 'responsible' || userRole === 'admin';

  return {
    contractId,
    userId,
    userRole,
    canReadMeta,
    canReadSeller: options.requiresHandshakeVerification ? false : canReadSeller,
    canEditSeller: editable && canReadSeller && !options.requiresHandshakeVerification,
    canReadBuyer: options.requiresHandshakeVerification ? false : canReadBuyer,
    canEditBuyer: editable && canReadBuyer && !options.requiresHandshakeVerification,
    isReadOnly: !editable || Boolean(options.requiresHandshakeVerification),
    requiresHandshakeVerification: Boolean(options.requiresHandshakeVerification),
    handshakeStatus: options.handshakeStatus ?? null,
    workflowStatus,
  };
}

/**
 * Pure authorization decision for one contract. Proposal actors are mapped to a
 * side explicitly; never infer access from brokers, CPF, or qualification data.
 */
export function resolveContractAccessContext(
  user: ContractAccessUser,
  contract: ContractAccessRecord
): ContractAccessContext {
  const contractId = String(contract.id ?? '').trim();
  const userId = normalizePositiveId(user.id) ?? '';
  const workflowStatus = String(contract.status ?? '').trim().toUpperCase();
  if (!contractId || !userId) {
    return buildContext(contractId, userId, 'none', false, workflowStatus);
  }

  const requestRole = String(user.role ?? '').trim().toLowerCase();
  const advertiserId = normalizePositiveId(contract.advertiser_id);
  const propertyOwnerId = normalizePositiveId(contract.property_owner_id);
  const proposerId = normalizePositiveId(contract.proposer_id);
  const legalBuyerUserId = normalizePositiveId(contract.legal_buyer_user_id);
  const initiatorSide = String(contract.initiator_side ?? '').trim().toLowerCase();
  const handshakeStatusRaw = String(contract.handshake_status ?? '').trim().toUpperCase();
  const handshakeStatus =
    handshakeStatusRaw === 'PENDING' ||
    handshakeStatusRaw === 'VERIFIED' ||
    handshakeStatusRaw === 'REJECTED'
      ? handshakeStatusRaw
      : null;

  // Admin keeps operational access so duplicate identities can be repaired.
  if (requestRole === 'admin') {
    return buildContext(contractId, userId, 'admin', true, workflowStatus);
  }

  const sellerIds = new Set<string>();
  const buyerIds = new Set<string>();

  // Both the property owner and the explicitly assigned advertiser operate
  // the seller side. These are identity links, never textual inferences.
  if (propertyOwnerId) sellerIds.add(propertyOwnerId);
  if (advertiserId) sellerIds.add(advertiserId);
  if (initiatorSide === 'seller') {
    if (proposerId) sellerIds.add(proposerId);
  } else if (initiatorSide === 'buyer') {
    if (proposerId) buyerIds.add(proposerId);
  } else if (proposerId) {
    // Legacy negotiations predate initiator_side. Preserve the former mapping
    // without using textual legal qualification as an authorization source.
    buyerIds.add(proposerId);
  }
  if (legalBuyerUserId) buyerIds.add(legalBuyerUserId);

  let role: ContractRole = 'none';
  if (responsibleIds(contract.responsible_user_ids).has(userId)) {
    role = 'responsible';
  } else if (sellerIds.has(userId) && buyerIds.has(userId)) {
    // One account cannot be silently granted bilateral participant access.
    return buildContext(contractId, userId, 'none', false, workflowStatus);
  } else if (sellerIds.has(userId)) {
    role = 'seller';
  } else if (buyerIds.has(userId)) {
    role = 'buyer';
  }

  const workflowFrozen =
    workflowStatus === 'IN_DRAFT' ||
    workflowStatus === 'AWAITING_SIGNATURES' ||
    workflowStatus === 'FINALIZED' ||
    workflowStatus === 'CANCELLED';
  const requiresHandshakeVerification =
    role === 'buyer' &&
    legalBuyerUserId === userId &&
    handshakeStatus === 'PENDING' &&
    String(contract.handshake_pin ?? '').trim().length > 0;
  return buildContext(
    contractId,
    userId,
    role,
    role !== 'none' && !workflowFrozen,
    workflowStatus,
    { requiresHandshakeVerification, handshakeStatus }
  );
}
