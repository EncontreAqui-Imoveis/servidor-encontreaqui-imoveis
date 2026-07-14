export type ContractRole = 'seller' | 'buyer' | 'responsible' | 'admin' | 'none';

export interface ContractAccessContext {
  contractId: string;
  userId: string;
  userRole: ContractRole;
  canReadMeta: boolean;
  canReadSeller: boolean;
  canEditSeller: boolean;
  canReadBuyer: boolean;
  canEditBuyer: boolean;
  /** True when participant-facing data and document mutations are frozen. */
  isReadOnly: boolean;
  /** True only for a linked legal buyer who must confirm the PIN first. */
  requiresHandshakeVerification: boolean;
  handshakeStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
  workflowStatus: string;
}
