import type { CommissionRule } from './CommissionRulesRepository';
import type { CommissionInsert } from './CommissionsRepository';

export type NegotiationCommissionInput = {
  finalValue: number;
  capturingBrokerId: number;
  sellingBrokerId?: number | null;
};

export function calculateCommissions(
  negotiation: NegotiationCommissionInput,
  rule: CommissionRule
): CommissionInsert[] {
  const finalValue = negotiation.finalValue;

  const capturingPercentage = rule.capturingPercentage;
  const sellingPercentage = rule.sellingPercentage;
  const totalPercentage = rule.totalPercentage;

  const buildCommission = (
    brokerId: number,
    role: CommissionInsert['role'],
    percentage: number
  ): CommissionInsert => ({
    brokerId,
    role,
    amount: Number(((finalValue * percentage) / 100).toFixed(2)),
  });

  const capturingBrokerId = negotiation.capturingBrokerId;
  const sellingBrokerId = negotiation.sellingBrokerId ?? null;

  if (sellingBrokerId == null || capturingBrokerId === sellingBrokerId) {
    return [buildCommission(capturingBrokerId, 'CAPTURING', totalPercentage)];
  }

  return [
    buildCommission(capturingBrokerId, 'CAPTURING', capturingPercentage),
    buildCommission(sellingBrokerId, 'SELLING', sellingPercentage),
  ];
}
