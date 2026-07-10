import type { AuthRequest } from '../middlewares/auth';
import { normalizeCpfDigits } from './cpfValidator';
import { resolveContractAccessContext as resolveStrictContractAccessContext } from './contractAccessResolver';

export interface ContractIdentityLike {
  id?: string | null;
  status?: string | null;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  seller_client_id: number | null;
  buyer_client_id: number | null;
  client_cpf: string | null;
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

function isSameCpf(left: string | null | undefined, right: string | null | undefined): boolean {
  const normalizedLeft = normalizeCpfDigits(String(left ?? ''));
  const normalizedRight = normalizeCpfDigits(String(right ?? ''));
  return normalizedLeft.length === 11 && normalizedLeft === normalizedRight;
}

export function isBuyerSideUser(
  contract: ContractIdentityLike,
  userId: number,
  userCpf?: string | null
): boolean {
  return (
    userId === Number(contract.buyer_client_id ?? 0) ||
    isSameCpf(userCpf, contract.client_cpf)
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
  const userId = Number(req.userId ?? 0);
  if (!Number.isFinite(userId) || userId <= 0) {
    return null;
  }

  const strictContext = resolveStrictContractAccessContext(
    { id: req.userId, role: req.userRole, cpf: req.userCpf },
    {
      id: String(contract.id ?? ''),
      status: contract.status,
      seller_client_id: contract.seller_client_id,
      buyer_client_id: contract.buyer_client_id,
      seller_cpf: contract.seller_cpf,
      buyer_cpf: contract.buyer_cpf ?? contract.client_cpf,
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
