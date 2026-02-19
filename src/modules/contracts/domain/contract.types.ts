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
] as const;

export type ContractDocumentType = (typeof CONTRACT_DOCUMENT_TYPES)[number];

export type ContractPartyInfo = Record<string, unknown>;

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
