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

export interface NegotiationRow {
  id: number;
  property_id: number;
  captador_user_id: number;
  seller_broker_user_id: number;
  status: NegotiationStatus;
  active: number; // 0 or 1
  started_at: Date | null;
  expires_at: Date | null;
  last_activity_at: Date | null;
  created_by_user_id: number;
  created_at: Date;
  updated_at: Date;
}

export type DocumentStatus = 'PENDING_REVIEW' | 'APPROVED' | 'APPROVED_WITH_REMARKS' | 'REJECTED';

export interface NegotiationDocumentRow {
  id: number;
  negotiation_id: number;
  doc_name: string;
  doc_url: string;
  status: DocumentStatus;
  review_comment: string | null;
  uploaded_by_user_id: number;
  reviewed_by_user_id: number | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface NegotiationContractRow {
  id: number;
  negotiation_id: number;
  version: number;
  contract_url: string;
  uploaded_by_admin_id: number;
  created_at: Date;
}

export type SignatureRole = 'CAPTADOR' | 'SELLER_BROKER' | 'CLIENT';
export type SignatureValidationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface NegotiationSignatureRow {
  id: number;
  negotiation_id: number;
  signed_by_role: SignatureRole;
  signed_file_url: string;
  signed_proof_image_url: string | null;
  signed_by_user_id: number | null;
  validation_status: SignatureValidationStatus;
  validation_comment: string | null;
  validated_by_admin_id: number | null;
  validated_at: Date | null;
  created_at: Date;
}

export type CloseType = 'SOLD' | 'RENTED';
export type CommissionMode = 'PERCENT' | 'AMOUNT';

export interface NegotiationCloseSubmissionRow {
  id: number;
  negotiation_id: number;
  close_type: CloseType;
  commission_mode: CommissionMode;
  commission_total_percent: string | null; // Decimal returned as string
  commission_total_amount: string | null;
  payment_proof_url: string;
  submitted_by_user_id: number;
  approved_by_admin_id: number | null;
  approved_at: Date | null;
  no_commission_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export type SplitRole = 'CAPTADOR' | 'PLATFORM' | 'SELLER_BROKER';

export interface CommissionSplitRow {
  id: number;
  close_submission_id: number;
  split_role: SplitRole;
  recipient_user_id: number | null;
  percent_value: string | null;
  amount_value: string | null;
  created_at: Date;
}
export interface CreateNegotiationDTO {
  property_id: number;
  captador_user_id: number;
  seller_broker_user_id: number;
  created_by_user_id: number;
}
