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
}
