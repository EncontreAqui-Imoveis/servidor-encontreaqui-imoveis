"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTRACT_DOCUMENT_TYPES = exports.CONTRACT_APPROVAL_STATUSES = exports.CONTRACT_STATUSES = void 0;
exports.isContractStatus = isContractStatus;
exports.isContractApprovalStatus = isContractApprovalStatus;
exports.isContractDocumentType = isContractDocumentType;
exports.CONTRACT_STATUSES = [
    'AWAITING_DOCS',
    'IN_DRAFT',
    'AWAITING_SIGNATURES',
    'FINALIZED',
];
exports.CONTRACT_APPROVAL_STATUSES = [
    'PENDING',
    'APPROVED',
    'APPROVED_WITH_RES',
    'REJECTED',
];
exports.CONTRACT_DOCUMENT_TYPES = [
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
];
function isContractStatus(value) {
    return typeof value === 'string' && exports.CONTRACT_STATUSES.includes(value);
}
function isContractApprovalStatus(value) {
    return (typeof value === 'string' &&
        exports.CONTRACT_APPROVAL_STATUSES.includes(value));
}
function isContractDocumentType(value) {
    return (typeof value === 'string' &&
        exports.CONTRACT_DOCUMENT_TYPES.includes(value));
}
