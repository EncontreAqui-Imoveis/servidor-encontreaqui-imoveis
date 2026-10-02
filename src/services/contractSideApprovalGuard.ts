import type { ContractRow } from '../controllers/ContractController';

export const SIDE_ALREADY_APPROVED_CODE = 'SIDE_ALREADY_APPROVED';
export const SIDE_ALREADY_APPROVED_MESSAGE =
  'Este lado já foi aprovado. Reinicie a análise antes de fazer alterações.';

export type ContractDocumentSide = 'seller' | 'buyer';

export function isContractSideApproved(
  contract: Pick<ContractRow, 'seller_approval_status' | 'buyer_approval_status'>,
  side: ContractDocumentSide
): boolean {
  const status = String(
    side === 'seller'
      ? contract.seller_approval_status
      : contract.buyer_approval_status
  )
    .trim()
    .toUpperCase();

  return status === 'APPROVED' || status === 'APPROVED_WITH_RES';
}
