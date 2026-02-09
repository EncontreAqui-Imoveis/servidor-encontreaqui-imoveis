export type NegotiationStatus =
  | 'DRAFT'
  | 'PENDING_ACTIVATION'
  | 'DOCS_IN_REVIEW'
  | 'CONTRACT_AVAILABLE'
  | 'SIGNED_PENDING_VALIDATION'
  | 'CLOSE_SUBMITTED'
  | 'SOLD_COMMISSIONED'
  | 'RENTED_COMMISSIONED'
  | 'SOLD_NO_COMMISSION'
  | 'RENTED_NO_COMMISSION'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'ARCHIVED';

export type NegotiationDocStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'APPROVED_WITH_REMARKS'
  | 'REJECTED';

export type SignatureRole = 'CAPTADOR' | 'SELLER_BROKER' | 'CLIENT';
export type SignatureValidationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type CloseType = 'SOLD' | 'RENTED';
export type CommissionMode = 'PERCENT' | 'AMOUNT';

export type SplitRole = 'CAPTADOR' | 'PLATFORM' | 'SELLER_BROKER';

export type NegotiationFinalStatus =
  | 'SOLD_COMMISSIONED'
  | 'RENTED_COMMISSIONED'
  | 'SOLD_NO_COMMISSION'
  | 'RENTED_NO_COMMISSION';

export const NEGOTIATION_FINAL_STATUSES: ReadonlySet<NegotiationStatus> = new Set([
  'SOLD_COMMISSIONED',
  'RENTED_COMMISSIONED',
  'SOLD_NO_COMMISSION',
  'RENTED_NO_COMMISSION',
  'CANCELLED',
  'EXPIRED',
  'ARCHIVED',
]);

export interface Negotiation {
  id: number;
  property_id: number;
  captador_user_id: number;
  seller_broker_user_id: number;
  status: NegotiationStatus;
  active: number;
  started_at: Date | null;
  expires_at: Date | null;
  last_activity_at: Date | null;
  created_by_user_id: number;
  created_at: Date;
  updated_at: Date;
}
