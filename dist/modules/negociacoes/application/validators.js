"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = void 0;
exports.ensureRequiredString = ensureRequiredString;
exports.ensureInteger = ensureInteger;
exports.normalizeDocStatus = normalizeDocStatus;
exports.normalizeSignatureRole = normalizeSignatureRole;
exports.normalizeSignatureValidationStatus = normalizeSignatureValidationStatus;
exports.normalizeCloseType = normalizeCloseType;
exports.normalizeCommissionMode = normalizeCommissionMode;
exports.normalizeSplitRole = normalizeSplitRole;
exports.ensurePositiveNumber = ensurePositiveNumber;
class ValidationError extends Error {
    statusCode;
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'ValidationError';
        this.statusCode = statusCode;
    }
}
exports.ValidationError = ValidationError;
function ensureRequiredString(value, fieldLabel) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        throw new ValidationError(`${fieldLabel} é obrigatório.`);
    }
    return normalized;
}
function ensureInteger(value, fieldLabel) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new ValidationError(`${fieldLabel} inválido.`);
    }
    return parsed;
}
function normalizeDocStatus(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'PENDING_REVIEW' || normalized === 'APPROVED' || normalized === 'APPROVED_WITH_REMARKS' || normalized === 'REJECTED') {
        return normalized;
    }
    throw new ValidationError('Status de revisão de documento inválido.');
}
function normalizeSignatureRole(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'CAPTADOR' || normalized === 'SELLER_BROKER' || normalized === 'CLIENT') {
        return normalized;
    }
    throw new ValidationError('signed_by_role inválido.');
}
function normalizeSignatureValidationStatus(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'APPROVED' || normalized === 'REJECTED' || normalized === 'PENDING') {
        return normalized;
    }
    throw new ValidationError('Status de validação de assinatura inválido.');
}
function normalizeCloseType(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'SOLD' || normalized === 'RENTED') {
        return normalized;
    }
    throw new ValidationError('close_type inválido. Use SOLD ou RENTED.');
}
function normalizeCommissionMode(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'PERCENT' || normalized === 'AMOUNT') {
        return normalized;
    }
    throw new ValidationError('commission_mode inválido. Use PERCENT ou AMOUNT.');
}
function normalizeSplitRole(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'CAPTADOR' || normalized === 'PLATFORM' || normalized === 'SELLER_BROKER') {
        return normalized;
    }
    throw new ValidationError('split_role inválido.');
}
function ensurePositiveNumber(value, fieldLabel) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ValidationError(`${fieldLabel} deve ser maior que zero.`);
    }
    return parsed;
}
