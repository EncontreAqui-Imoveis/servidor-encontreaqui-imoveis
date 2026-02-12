import type { PropertiesRepository as PropertiesRepositoryPort } from '../domain/states/NegotiationState';
import type { SqlExecutor } from './NegotiationRepository';

export class PropertiesRepository implements PropertiesRepositoryPort<SqlExecutor> {
  private readonly executor: SqlExecutor;
  private readonly logger: { warn: (message: string, meta?: Record<string, unknown>) => void };

  constructor(
    executor: SqlExecutor,
    logger: { warn: (message: string, meta?: Record<string, unknown>) => void } = console
  ) {
    this.executor = executor;
    this.logger = logger;
  }

  async getPropertyValue(params: { id: number; trx?: SqlExecutor }): Promise<number> {
    const executor = params.trx ?? this.executor;

    const sql = `
      SELECT price
      FROM properties
      WHERE id = ?
      LIMIT 1
    `;

    const result = await executor.execute<Array<{ price: number | string }>>(sql, [params.id]);
    const rows =
      Array.isArray(result) && Array.isArray(result[0]) ? result[0] : (result as Array<{ price: number | string }>);
    const row = rows?.[0];

    return Number(row?.price ?? 0);
  }

  async updateLifecycleStatus(params: {
    id: number;
    status: 'SOLD' | 'RENTED';
    trx: SqlExecutor;
  }): Promise<void> {
    const lifecycleStatus = params.status;
    const statusValue = params.status === 'SOLD' ? 'sold' : 'rented';

    const sql = `
      UPDATE properties
      SET lifecycle_status = ?, status = ?, visibility = 'HIDDEN'
      WHERE id = ?
    `;

    await params.trx.execute(sql, [lifecycleStatus, statusValue, params.id]);
  }

  async markUnderNegotiation(params: { id: number; trx: SqlExecutor }): Promise<void> {
    const sql = `
      UPDATE properties
      SET status = 'negociacao', lifecycle_status = 'AVAILABLE', visibility = 'HIDDEN'
      WHERE id = ?
    `;

    await params.trx.execute(sql, [params.id]);
  }

  async markAvailable(params: { id: number; trx: SqlExecutor }): Promise<void> {
    const sql = `
      UPDATE properties
      SET lifecycle_status = 'AVAILABLE', status = 'approved', visibility = 'PUBLIC'
      WHERE id = ?
        AND lifecycle_status NOT IN ('SOLD', 'RENTED')
        AND status NOT IN ('sold', 'rented')
    `;

    const result = await params.trx.execute<{ affectedRows?: number }>(sql, [params.id]);
    const affectedRows = Array.isArray(result) ? result[0]?.affectedRows ?? 0 : result?.affectedRows ?? 0;

    if (affectedRows === 0) {
      this.logger.warn('PropertiesRepository.markAvailable skipped due to sold/rented status.', {
        propertyId: params.id,
      });
    }
  }
}
