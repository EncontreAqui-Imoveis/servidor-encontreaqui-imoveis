import type { AuthRequest } from '../middlewares/auth';

export interface ContractIdentityLike {
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  seller_client_id: number | null;
  buyer_client_id: number | null;
  property_owner_id: number | null;
  proposal_initiator_user_id: number | null;
}

export interface ContractAccessContext {
  userId: number;
  role: string;
  isAdmin: boolean;
  isResponsible: boolean;
  isCapturingBroker: boolean;
  isSellingBroker: boolean;
  isBuyerSide: boolean;
  isSellerSide: boolean;
}

export function resolveSellerPartyId(contract: ContractIdentityLike): number {
  const ownerId = Number(contract.property_owner_id ?? 0);
  if (Number.isFinite(ownerId) && ownerId > 0) {
    return ownerId;
  }

  const legacySellerClientId = Number(contract.seller_client_id ?? 0);
  return Number.isFinite(legacySellerClientId) && legacySellerClientId > 0
    ? legacySellerClientId
    : 0;
}

export function resolveProposalInitiatorUserId(contract: ContractIdentityLike): number {
  const initiatorUserId = Number(contract.proposal_initiator_user_id ?? 0);
  return Number.isFinite(initiatorUserId) && initiatorUserId > 0 ? initiatorUserId : 0;
}

export function isBuyerSideUser(contract: ContractIdentityLike, userId: number): boolean {
  return (
    userId === Number(contract.buyer_client_id ?? 0) ||
    userId === resolveProposalInitiatorUserId(contract)
  );
}

export function isSellerSideUser(contract: ContractIdentityLike, userId: number): boolean {
  return userId === resolveSellerPartyId(contract);
}

export function resolveContractAccessContext(
  req: AuthRequest,
  contract: ContractIdentityLike,
  isResponsible: boolean,
): ContractAccessContext | null {
  const role = String(req.userRole ?? '').trim().toLowerCase();
  const userId = Number(req.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  return {
    userId,
    role,
    isAdmin: role === 'admin',
    isResponsible,
    isCapturingBroker: userId === Number(contract.capturing_broker_id ?? 0),
    isSellingBroker: userId === Number(contract.selling_broker_id ?? 0),
    isBuyerSide: isBuyerSideUser(contract, userId),
    isSellerSide: isSellerSideUser(contract, userId),
  };
}
