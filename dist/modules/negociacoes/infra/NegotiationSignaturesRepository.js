"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationSignaturesRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class NegotiationSignaturesRepository {
    async create(data, conn) {
        const db = conn || connection_1.default;
        const [result] = await db.query(`INSERT INTO negotiation_signatures 
       (negotiation_id, signed_by_role, signed_file_url, signed_proof_image_url, signed_by_user_id, validation_status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`, [data.negotiation_id, data.signed_by_role, data.signed_file_url, data.signed_proof_image_url || null, data.signed_by_user_id || null]);
        return result.insertId;
    }
    async findByNegotiationId(negotiationId) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_signatures WHERE negotiation_id = ?', [negotiationId]);
        return rows;
    }
    async findById(id) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_signatures WHERE id = ?', [id]);
        if (rows.length === 0)
            return null;
        return rows[0];
    }
    async updateValidation(id, status, comment, adminId, conn) {
        const db = conn || connection_1.default;
        await db.query(`UPDATE negotiation_signatures 
       SET validation_status = ?, validation_comment = ?, validated_by_admin_id = ?, validated_at = NOW()
       WHERE id = ?`, [status, comment, adminId, id]);
    }
}
exports.NegotiationSignaturesRepository = NegotiationSignaturesRepository;
