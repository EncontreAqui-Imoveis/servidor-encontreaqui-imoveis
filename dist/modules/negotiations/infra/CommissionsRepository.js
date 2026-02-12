"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommissionsRepository = void 0;
class CommissionsRepository {
    executor;
    constructor(executor) {
        this.executor = executor;
    }
    async insertMany(params) {
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
exports.CommissionsRepository = CommissionsRepository;
