"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationRepository = void 0;
const ConflictError_1 = require("../domain/errors/ConflictError");
const toAffectedRows = (result) => {
    const header = Array.isArray(result) ? result[0] : result;
    return header?.affectedRows ?? 0;
};
class NegotiationRepository {
    async updateStatusWithOptimisticLock(params) {
        const updateSql = `
      UPDATE negotiations
      SET status = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = ?
    `;
        const updateResult = await params.trx.execute(updateSql, [
            params.toStatus,
            params.id,
            params.expectedVersion,
            params.fromStatus,
        ]);
        if (toAffectedRows(updateResult) === 0) {
            throw new ConflictError_1.ConflictError('Negotiation version conflict.');
        }
        const historySql = `
      INSERT INTO negotiation_history
        (id, negotiation_id, from_status, to_status, actor_id, metadata_json, created_at)
      VALUES
        (UUID(), ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
        const metadataJson = params.metadata === undefined ? null : JSON.stringify(params.metadata ?? null);
        await params.trx.execute(historySql, [
            params.id,
            params.fromStatus,
            params.toStatus,
            params.actorId,
            metadataJson,
        ]);
    }
    async updateDraftWithOptimisticLock(params) {
        const updateSql = `
      UPDATE negotiations
      SET
        payment_details = ?,
        final_value = ?,
        proposal_validity_date = ?,
        selling_broker_id = ?,
        version = version + 1
      WHERE id = ? AND version = ?
    `;
        const paymentDetailsJson = JSON.stringify(params.paymentDetails);
        const result = await params.trx.execute(updateSql, [
            paymentDetailsJson,
            params.finalValue,
            params.proposalValidityDate,
            params.sellingBrokerId,
            params.id,
            params.expectedVersion,
        ]);
        return toAffectedRows(result);
    }
}
exports.NegotiationRepository = NegotiationRepository;
