export const CONTRACT_STATUSES = [
  'AWAITING_DOCS',
  'IN_DRAFT',
  'AWAITING_MINUTE_REVIEW',
  'AWAITING_SIGNATURES',
  'FINALIZED',
  // Historical terminal state: the record remains auditable after its
  // negotiation is cancelled, but no participant mutation is permitted.
  'CANCELLED',
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Commercial modality copied from the approved negotiation. */
export const CONTRACT_DEAL_TYPES = ['sale', 'rent'] as const;

export type ContractDealType = (typeof CONTRACT_DEAL_TYPES)[number];

export function isContractDealType(value: unknown): value is ContractDealType {
  return typeof value === 'string' && CONTRACT_DEAL_TYPES.includes(value as ContractDealType);
}

export const CONTRACT_APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'APPROVED_WITH_RES',
  'REJECTED',
] as const;

export type ContractApprovalStatus = (typeof CONTRACT_APPROVAL_STATUSES)[number];

/** Documentos pessoais do cliente (comprador): CNH, RG, CPF + até 20 anexos opcionais numerados. */
export const CLIENTE_OUTRO_SLOT_TYPES = [
  'cliente_outro_01',
  'cliente_outro_02',
  'cliente_outro_03',
  'cliente_outro_04',
  'cliente_outro_05',
  'cliente_outro_06',
  'cliente_outro_07',
  'cliente_outro_08',
  'cliente_outro_09',
  'cliente_outro_10',
  'cliente_outro_11',
  'cliente_outro_12',
  'cliente_outro_13',
  'cliente_outro_14',
  'cliente_outro_15',
  'cliente_outro_16',
  'cliente_outro_17',
  'cliente_outro_18',
  'cliente_outro_19',
  'cliente_outro_20',
] as const;

export const CONTRACT_DOCUMENT_TYPES = [
  'doc_identidade',
  'doc_identidade_conjuge',
  'comprovante_endereco',
  'certidao_casamento_nascimento',
  'certidao_inteiro_teor',
  'certidao_onus_acoes',
  'comprovante_renda',
  'seguro_incendio',
  'dados_bancarios',
  'contrato_minuta',
  'contrato_assinado',
  'comprovante_pagamento',
  'boleto_vistoria',
  'outro',
  'cliente_cnh',
  'cliente_identidade',
  'cliente_cpf',
  ...CLIENTE_OUTRO_SLOT_TYPES,
] as const;

export type ContractDocumentType = (typeof CONTRACT_DOCUMENT_TYPES)[number];

/**
 * These documents belong to the contractual process, never to one party's
 * qualification dossier. They remain readable by both parties after a stage
 * is frozen, while personal documents keep their side isolation.
 */
export const CONTRACT_SHARED_DOCUMENT_TYPES = [
  'contrato_minuta',
  'contrato_assinado',
  'comprovante_pagamento',
  'boleto_vistoria',
] as const;

export type ContractSharedDocumentType = (typeof CONTRACT_SHARED_DOCUMENT_TYPES)[number];

export function isContractSharedDocumentType(value: unknown): value is ContractSharedDocumentType {
  return (
    typeof value === 'string' &&
    CONTRACT_SHARED_DOCUMENT_TYPES.includes(value as ContractSharedDocumentType)
  );
}

export type ContractPartyInfo = Record<string, unknown>;

export type ContractDocumentOwnerSide = 'seller' | 'buyer';

export interface ContractDocumentMetadata {
  /** Present only for a personal document owned by one party. */
  owner_side?: ContractDocumentOwnerSide;
  /** @deprecated Read-only compatibility for records created before owner_side. */
  side?: ContractDocumentOwnerSide;
  visibility?: 'SIDE_PRIVATE' | 'CONTRACT_SHARED';
  [key: string]: unknown;
}

export const CONTRACT_DOCUMENT_CATEGORY_LABELS: Record<
  (typeof CONTRACT_DOCUMENT_CATEGORY_CODES)[number],
  string
> = {
  identidade: 'Documento Pessoal',
  comprovante_endereco: 'Comprovante de Endereço',
  estado_civil: 'Certidão de Estado Civil',
  conjuge_documentos: 'Documento Pessoal (Cônjuge)',
  comprovante_renda: 'Comprovante de Renda',
  seguro_incendio: 'Apólice/Comprovante de Seguro Incêndio',
  dados_bancarios: 'Dados Bancários',
  certidao_inteiro_teor_escritura: 'Certidão de Inteiro Teor/Escritura',
  certidao_onus_acoes: 'Certidão de Ônus/Ações',
  outro: 'Outro',
};

export const CONTRACT_DOCUMENT_CATEGORY_CODES = [
  'identidade',
  'comprovante_endereco',
  'estado_civil',
  'conjuge_documentos',
  'comprovante_renda',
  'seguro_incendio',
  'dados_bancarios',
  'certidao_inteiro_teor_escritura',
  'certidao_onus_acoes',
  'outro',
] as const;

export type ContractDocumentCategoryCode =
  (typeof CONTRACT_DOCUMENT_CATEGORY_CODES)[number];

export const CONTRACT_DOCUMENT_CATEGORY_STATUSES = [
  'PENDING',
  'APPROVED',
  'APPROVED_WITH_RES',
  'REJECTED',
  'NOT_APPLICABLE',
] as const;

export type ContractDocumentCategoryStatus =
  (typeof CONTRACT_DOCUMENT_CATEGORY_STATUSES)[number];

export const CONTRACT_DOCUMENT_VALIDATION_CODES = [
  'CATEGORY_REQUIRED',
  'CATEGORY_INVALID',
  'SIDE_REQUIRED',
  'SIDE_INVALID',
  'EXTENSION_INVALID',
  'MIME_INVALID',
  'FILE_TOO_SMALL',
  'FILE_TOO_LARGE',
  'TYPE_CATEGORY_MISMATCH',
  'STATUS_LOCKED',
  'CATEGORY_NOT_APPLICABLE',
] as const;

export type ContractDocumentValidationCode =
  (typeof CONTRACT_DOCUMENT_VALIDATION_CODES)[number];

export function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === 'string' && CONTRACT_STATUSES.includes(value as ContractStatus);
}

export function isContractApprovalStatus(
  value: unknown
): value is ContractApprovalStatus {
  return (
    typeof value === 'string' &&
    CONTRACT_APPROVAL_STATUSES.includes(value as ContractApprovalStatus)
  );
}

export function isContractDocumentType(value: unknown): value is ContractDocumentType {
  return (
    typeof value === 'string' &&
    CONTRACT_DOCUMENT_TYPES.includes(value as ContractDocumentType)
  );
}

export function isContractDocumentCategoryCode(
  value: unknown
): value is ContractDocumentCategoryCode {
  return (
    typeof value === 'string' &&
    CONTRACT_DOCUMENT_CATEGORY_CODES.includes(value as ContractDocumentCategoryCode)
  );
}

export function isContractDocumentCategoryStatus(
  value: unknown
): value is ContractDocumentCategoryStatus {
  return (
    typeof value === 'string' &&
    CONTRACT_DOCUMENT_CATEGORY_STATUSES.includes(
      value as ContractDocumentCategoryStatus
    )
  );
}
