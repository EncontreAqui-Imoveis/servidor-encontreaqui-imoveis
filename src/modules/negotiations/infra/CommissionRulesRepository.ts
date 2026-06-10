import type { SqlExecutor } from './NegotiationRepository';
import { toRows } from './sqlResultHelpers';
import {
  normalizeCommissionRuleRow,
  type CommissionRule,
  type CommissionRuleRow,
} from './commissionRuleHelpers';

export type { CommissionRule } from './commissionRuleHelpers';

export class CommissionRulesRepository {
  private readonly executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.executor = executor;
  }

  async getActiveRule(params: { trx?: SqlExecutor } = {}): Promise<CommissionRule> {
    const executor = params.trx ?? this.executor;
    const sql = `
      SELECT
        capturing_percentage,
        selling_percentage,
        total_percentage
      FROM commission_rules
      WHERE is_active = 1
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const rows = toRows<CommissionRuleRow>(await executor.execute<CommissionRuleRow[]>(sql));
    return normalizeCommissionRuleRow(rows?.[0]);
  }
}
