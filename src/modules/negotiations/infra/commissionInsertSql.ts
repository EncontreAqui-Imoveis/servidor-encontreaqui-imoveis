import { ValidationError } from '../domain/errors/ValidationError';
import type { CommissionInsert } from './CommissionsRepository';

export function buildCommissionInsertStatement(params: {
  negotiationId: string;
  commissions: CommissionInsert[];
}): { sql: string; bindings: Array<string | number> } {
  if (params.commissions.some((commission) => !Number.isFinite(commission.brokerId))) {
    throw new ValidationError('Invalid broker id for commission insert.');
  }

  if (params.commissions.some((commission) => !Number.isFinite(commission.amount))) {
    throw new ValidationError('Invalid commission amount for commission insert.');
  }

  const valuesSql = params.commissions
    .map(() => "(UUID(), ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)")
    .join(', ');

  return {
    sql: `
      INSERT INTO commissions
        (id, negotiation_id, broker_id, role, amount, status, created_at)
      VALUES ${valuesSql}
    `,
    bindings: params.commissions.flatMap((commission) => [
      params.negotiationId,
      commission.brokerId,
      commission.role,
      commission.amount,
    ]),
  };
}
