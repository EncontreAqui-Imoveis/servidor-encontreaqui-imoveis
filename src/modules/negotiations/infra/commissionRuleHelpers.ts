import { ValidationError } from '../domain/errors/ValidationError';

export interface CommissionRule {
  capturingPercentage: number;
  sellingPercentage: number;
  totalPercentage: number;
}

export interface CommissionRuleRow {
  capturing_percentage: number | string | null;
  selling_percentage: number | string | null;
  total_percentage: number | string | null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('Invalid commission rule row.');
  }

  return parsed;
}

export function normalizeCommissionRuleRow(row: CommissionRuleRow | null | undefined): CommissionRule {
  if (!row) {
    throw new ValidationError('Active commission rule not found.');
  }

  const capturing = toFiniteNumber(row.capturing_percentage);
  const selling = toFiniteNumber(row.selling_percentage);
  const total =
    row.total_percentage !== null && row.total_percentage !== undefined
      ? toFiniteNumber(row.total_percentage)
      : capturing + selling;

  return {
    capturingPercentage: capturing,
    sellingPercentage: selling,
    totalPercentage: total,
  };
}
