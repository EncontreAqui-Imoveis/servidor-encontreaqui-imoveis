import type { SqlExecutor } from './NegotiationRepository';

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
    const valuesSql = params.commissions
      .map(() => "(UUID(), ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)")
      .join(', ');

    const sql = `
      INSERT INTO commissions
        (id, negotiation_id, broker_id, role, amount, status, created_at)
      VALUES ${valuesSql}
    `;

    const bindings = params.commissions.flatMap((commission) => [
      params.negotiationId,
      commission.brokerId,
      commission.role,
      commission.amount,
    ]);

    await executor.execute(sql, bindings);
  }
}
