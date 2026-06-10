import { ValidationError } from '../domain/errors/ValidationError';

export interface CommissionNegotiationRow {
  final_value: number | string | null;
  capturing_broker_id: number | string | null;
  selling_broker_id: number | string | null;
}

export interface CommissionNegotiationInput {
  finalValue: number;
  capturingBrokerId: number;
  sellingBrokerId: number | null;
}

function toOptionalFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('Invalid negotiation row for commission calculation.');
  }

  return parsed;
}

export function mapCommissionNegotiationRow(row: CommissionNegotiationRow): CommissionNegotiationInput {
  const finalValue = toOptionalFiniteNumber(row.final_value);
  if (finalValue == null || finalValue <= 0) {
    throw new ValidationError('final_value is required to calculate commissions.');
  }

  const capturingBrokerId = toOptionalFiniteNumber(row.capturing_broker_id);
  if (capturingBrokerId == null) {
    throw new ValidationError('capturing_broker_id is required to calculate commissions.');
  }

  return {
    finalValue,
    capturingBrokerId,
    sellingBrokerId: toOptionalFiniteNumber(row.selling_broker_id),
  };
}
