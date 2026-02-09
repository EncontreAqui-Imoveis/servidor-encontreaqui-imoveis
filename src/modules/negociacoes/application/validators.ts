import { CloseType, CommissionMode, NegotiationDocStatus, SignatureRole, SignatureValidationStatus, SplitRole } from '../domain/types';

export class ValidationError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

export function ensureRequiredString(value: unknown, fieldLabel: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new ValidationError(`${fieldLabel} é obrigatório.`);
  }
  return normalized;
}

export function ensureInteger(value: unknown, fieldLabel: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${fieldLabel} inválido.`);
  }
  return parsed;
}

export function normalizeDocStatus(value: unknown): NegotiationDocStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PENDING_REVIEW' || normalized === 'APPROVED' || normalized === 'APPROVED_WITH_REMARKS' || normalized === 'REJECTED') {
    return normalized;
  }
  throw new ValidationError('Status de revisão de documento inválido.');
}

export function normalizeSignatureRole(value: unknown): SignatureRole {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'CAPTADOR' || normalized === 'SELLER_BROKER' || normalized === 'CLIENT') {
    return normalized;
  }
  throw new ValidationError('signed_by_role inválido.');
}

export function normalizeSignatureValidationStatus(value: unknown): SignatureValidationStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'APPROVED' || normalized === 'REJECTED' || normalized === 'PENDING') {
    return normalized;
  }
  throw new ValidationError('Status de validação de assinatura inválido.');
}

export function normalizeCloseType(value: unknown): CloseType {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'SOLD' || normalized === 'RENTED') {
    return normalized;
  }
  throw new ValidationError('close_type inválido. Use SOLD ou RENTED.');
}

export function normalizeCommissionMode(value: unknown): CommissionMode {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'PERCENT' || normalized === 'AMOUNT') {
    return normalized;
  }
  throw new ValidationError('commission_mode inválido. Use PERCENT ou AMOUNT.');
}

export function normalizeSplitRole(value: unknown): SplitRole {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'CAPTADOR' || normalized === 'PLATFORM' || normalized === 'SELLER_BROKER') {
    return normalized;
  }
  throw new ValidationError('split_role inválido.');
}

export function ensurePositiveNumber(value: unknown, fieldLabel: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError(`${fieldLabel} deve ser maior que zero.`);
  }
  return parsed;
}
