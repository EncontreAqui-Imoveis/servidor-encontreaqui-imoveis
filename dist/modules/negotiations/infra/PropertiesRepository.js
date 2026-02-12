"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropertiesRepository = void 0;
class PropertiesRepository {
    executor;
    logger;
    constructor(executor, logger = console) {
        this.executor = executor;
        this.logger = logger;
    }
    async getPropertyValue(params) {
        const executor = params.trx ?? this.executor;
        const sql = `
      SELECT price
      FROM properties
      WHERE id = ?
      LIMIT 1
    `;
        const result = await executor.execute(sql, [params.id]);
        const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
        const row = rows?.[0];
        return Number(row?.price ?? 0);
    }
    async updateLifecycleStatus(params) {
        const lifecycleStatus = params.status;
        const statusValue = params.status === 'SOLD' ? 'sold' : 'rented';
        const sql = `
      UPDATE properties
      SET lifecycle_status = ?, status = ?, visibility = 'HIDDEN'
      WHERE id = ?
    `;
        await params.trx.execute(sql, [lifecycleStatus, statusValue, params.id]);
    }
    async markUnderNegotiation(params) {
        const sql = `
      UPDATE properties
      SET status = 'negociacao', lifecycle_status = 'AVAILABLE', visibility = 'HIDDEN'
      WHERE id = ?
    `;
        await params.trx.execute(sql, [params.id]);
    }
    async markAvailable(params) {
        const sql = `
      UPDATE properties
      SET lifecycle_status = 'AVAILABLE', status = 'approved', visibility = 'PUBLIC'
      WHERE id = ?
        AND lifecycle_status NOT IN ('SOLD', 'RENTED')
        AND status NOT IN ('sold', 'rented')
    `;
        const result = await params.trx.execute(sql, [params.id]);
        const affectedRows = Array.isArray(result) ? result[0]?.affectedRows ?? 0 : result?.affectedRows ?? 0;
        if (affectedRows === 0) {
            this.logger.warn('PropertiesRepository.markAvailable skipped due to sold/rented status.', {
                propertyId: params.id,
            });
        }
    }
}
exports.PropertiesRepository = PropertiesRepository;
