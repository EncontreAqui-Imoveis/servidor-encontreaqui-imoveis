"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationCloseSubmissionRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class NegotiationCloseSubmissionRepository {
    async create(data, conn) {
        const db = conn || connection_1.default;
        const [result] = await db.query(`INSERT INTO negotiation_close_submissions 
       (negotiation_id, close_type, commission_mode, commission_total_percent, commission_total_amount, payment_proof_url, submitted_by_user_id, no_commission_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [data.negotiation_id, data.close_type, data.commission_mode, data.commission_total_percent || null, data.commission_total_amount || null, data.payment_proof_url, data.submitted_by_user_id, data.no_commission_reason || null]);
        return result.insertId;
    }
    async findByNegotiationId(negotiationId) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_close_submissions WHERE negotiation_id = ? ORDER BY created_at DESC LIMIT 1', [negotiationId]);
        if (rows.length === 0)
            return null;
        return rows[0];
    }
    async findById(id) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_close_submissions WHERE id = ?', [id]);
        if (rows.length === 0)
            return null;
        return rows[0];
    }
    async approve(id, adminId, conn) {
        const db = conn || connection_1.default;
        await db.query(`UPDATE negotiation_close_submissions 
       SET approved_by_admin_id = ?, approved_at = NOW()
       WHERE id = ?`, [adminId, id]);
    }
    async markNoCommission(id, adminId, reason, conn) {
        const db = conn || connection_1.default;
        await db.query(`UPDATE negotiation_close_submissions
       SET no_commission_reason = ?, approved_by_admin_id = ?, approved_at = NOW()
       WHERE id = ?`, [reason, adminId, id]);
    }
}
exports.NegotiationCloseSubmissionRepository = NegotiationCloseSubmissionRepository;
