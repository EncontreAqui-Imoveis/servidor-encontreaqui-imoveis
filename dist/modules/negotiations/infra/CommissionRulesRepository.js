"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommissionRulesRepository = void 0;
const ValidationError_1 = require("../domain/errors/ValidationError");
const toRows = (result) => {
    if (Array.isArray(result) && Array.isArray(result[0])) {
        return result[0];
    }
    return result;
};
class CommissionRulesRepository {
    executor;
    constructor(executor) {
        this.executor = executor;
    }
    async getActiveRule(params = {}) {
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
        const rows = toRows(await executor.execute(sql));
        const rule = rows?.[0];
        if (!rule) {
            throw new ValidationError_1.ValidationError('Active commission rule not found.');
        }
        const capturing = Number(rule.capturing_percentage ?? 0);
        const selling = Number(rule.selling_percentage ?? 0);
        const total = rule.total_percentage !== null && rule.total_percentage !== undefined
            ? Number(rule.total_percentage)
            : capturing + selling;
        return {
            capturingPercentage: capturing,
            sellingPercentage: selling,
            totalPercentage: total,
        };
    }
}
exports.CommissionRulesRepository = CommissionRulesRepository;
