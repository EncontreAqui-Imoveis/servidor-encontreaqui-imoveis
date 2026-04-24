export const CONTRACT_STATUSES = [
  'AWAITING_DOCS',
  'IN_DRAFT',
  'AWAITING_SIGNATURES',
  'FINALIZED',
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

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
  'comprovante_endereco',
  'certidao_casamento_nascimento',
  'certidao_inteiro_teor',
  'certidao_onus_acoes',
  'comprovante_renda',
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

export type ContractPartyInfo = Record<string, unknown>;

export const CONTRACT_DOCUMENT_CATEGORY_CODES = [
  'identidade',
  'comprovante_endereco',
  'estado_civil',
  'conjuge_documentos',
  'comprovante_renda',
  'dados_bancarios',
  'docs_imovel',
] as const;

export type ContractDocumentCategoryCode =
  (typeof CONTRACT_DOCUMENT_CATEGORY_CODES)[number];

export const CONTRACT_DOCUMENT_CATEGORY_STATUSES = [
  'PENDING',
  'APPROVED',
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
