import type { AuthRequest } from '../middlewares/auth';
import { resolveContractAccessContext as resolveStrictContractAccessContext } from './contractAccessResolver';

export interface ContractIdentityLike {
  id?: string | null;
  status?: string | null;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  proposer_id?: number | null;
  advertiser_id?: number | null;
  property_owner_id: number | null;
  proposal_initiator_user_id: number | null;
  seller_cpf?: string | null;
  buyer_cpf?: string | null;
  responsible_user_ids?: string | null;
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
  const advertiserId = Number(contract.advertiser_id ?? 0);
  if (Number.isFinite(advertiserId) && advertiserId > 0) {
    return advertiserId;
  }

  const ownerId = Number(contract.property_owner_id ?? 0);
  if (Number.isFinite(ownerId) && ownerId > 0) {
    return ownerId;
  }

  return 0;
}

export function resolveProposalInitiatorUserId(contract: ContractIdentityLike): number {
  const proposerId = Number(contract.proposer_id ?? 0);
  if (Number.isFinite(proposerId) && proposerId > 0) {
    return proposerId;
  }

  const initiatorUserId = Number(contract.proposal_initiator_user_id ?? 0);
  return Number.isFinite(initiatorUserId) && initiatorUserId > 0 ? initiatorUserId : 0;
}

export function isBuyerSideUser(
  contract: ContractIdentityLike,
  userId: number,
): boolean {
  return userId === Number(contract.proposer_id ?? 0);
}

export function isSellerSideUser(contract: ContractIdentityLike, userId: number): boolean {
  return userId === resolveSellerPartyId(contract);
}

export function resolveContractAccessContext(
  req: AuthRequest,
  contract: ContractIdentityLike,
  isResponsible: boolean,
): ContractAccessContext | null {
  const userId = Number(req.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  const strictContext = resolveStrictContractAccessContext(
    { id: req.userId, role: req.userRole },
    {
      id: String(contract.id ?? ''),
      status: contract.status,
      advertiser_id: contract.advertiser_id ?? null,
      proposer_id: contract.proposer_id ?? null,
      responsible_user_ids: isResponsible
        ? [userId]
        : contract.responsible_user_ids ?? null,
    }
  );

  return {
    userId,
    role: String(req.userRole ?? '').trim().toLowerCase(),
    isAdmin: strictContext.userRole === 'admin',
    isResponsible: strictContext.userRole === 'responsible',
    isCapturingBroker: false,
    isSellingBroker: userId === Number(contract.selling_broker_id ?? 0),
    isBuyerSide: strictContext.userRole === 'buyer',
    isSellerSide: strictContext.userRole === 'seller',
  };
}
