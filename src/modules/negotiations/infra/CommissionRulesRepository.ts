import { ValidationError } from '../domain/errors/ValidationError';
import type { SqlExecutor } from './NegotiationRepository';

export interface CommissionRule {
  capturingPercentage: number;
  sellingPercentage: number;
  totalPercentage: number;
}

interface CommissionRuleRow {
  capturing_percentage: number | string | null;
  selling_percentage: number | string | null;
  total_percentage: number | string | null;
}

const toRows = <T>(result: T[] | [T[], unknown]): T[] => {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return result as T[];
};

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
    const rule = rows?.[0];

    if (!rule) {
      throw new ValidationError('Active commission rule not found.');
    }

    const capturing = Number(rule.capturing_percentage ?? 0);
    const selling = Number(rule.selling_percentage ?? 0);
    const total =
      rule.total_percentage !== null && rule.total_percentage !== undefined
        ? Number(rule.total_percentage)
        : capturing + selling;

    return {
      capturingPercentage: capturing,
      sellingPercentage: selling,
      totalPercentage: total,
    };
  }
}
