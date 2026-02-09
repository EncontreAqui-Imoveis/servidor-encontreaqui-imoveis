"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationCloseSubmissionRepository = void 0;
const db_1 = require("./db");
class NegotiationCloseSubmissionRepository {
    db;
    constructor(db = (0, db_1.getDefaultQueryRunner)()) {
        this.db = db;
    }
    async create(params) {
        const [result] = await this.db.query(`
      INSERT INTO negotiation_close_submissions (
        negotiation_id,
        close_type,
        commission_mode,
        commission_total_percent,
        commission_total_amount,
        payment_proof_url,
        submitted_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
            params.negotiationId,
            params.closeType,
            params.commissionMode,
            params.commissionTotalPercent,
            params.commissionTotalAmount,
            params.paymentProofUrl,
            params.submittedByUserId,
        ]);
        return result.insertId;
    }
    async findLatestByNegotiationId(negotiationId) {
        const [rows] = await this.db.query(`
      SELECT *
      FROM negotiation_close_submissions
      WHERE negotiation_id = ?
      ORDER BY created_at DESC
      LIMIT 1
      `, [negotiationId]);
        return rows[0] ?? null;
    }
    async markApproved(submissionId, approvedByAdminId) {
        await this.db.query('UPDATE negotiation_close_submissions SET approved_by_admin_id = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?', [approvedByAdminId, submissionId]);
    }
    async markNoCommission(submissionId, approvedByAdminId, reason) {
        await this.db.query(`
      UPDATE negotiation_close_submissions
      SET approved_by_admin_id = ?, approved_at = NOW(), no_commission_reason = ?, updated_at = NOW()
      WHERE id = ?
      `, [approvedByAdminId, reason, submissionId]);
    }
}
exports.NegotiationCloseSubmissionRepository = NegotiationCloseSubmissionRepository;
