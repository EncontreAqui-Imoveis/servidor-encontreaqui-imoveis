import type { SqlExecutor } from './NegotiationRepository';
import { buildCommissionInsertStatement } from './commissionInsertSql';

export interface CommissionInsert {
  brokerId: number;
  role: 'CAPTURING' | 'SELLING';
  amount: number;
}

export class CommissionsRepository {
  private readonly executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.executor = executor;
  }

  async insertMany(params: {
    negotiationId: string;
    commissions: CommissionInsert[];
    trx?: SqlExecutor;
  }): Promise<void> {
    if (params.commissions.length === 0) {
      return;
    }

    const executor = params.trx ?? this.executor;
    const { sql, bindings } = buildCommissionInsertStatement({
      negotiationId: params.negotiationId,
      commissions: params.commissions,
    });

    await executor.execute(sql, bindings);
  }
}
