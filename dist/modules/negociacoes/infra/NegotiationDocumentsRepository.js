"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationDocumentsRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class NegotiationDocumentsRepository {
    async create(data, conn) {
        const db = conn || connection_1.default;
        const [result] = await db.query(`INSERT INTO negotiation_documents 
       (negotiation_id, doc_name, doc_url, uploaded_by_user_id, status)
       VALUES (?, ?, ?, ?, 'PENDING_REVIEW')`, [data.negotiation_id, data.doc_name, data.doc_url, data.uploaded_by_user_id]);
        return result.insertId;
    }
    async findByNegotiationId(negotiationId) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_documents WHERE negotiation_id = ? ORDER BY created_at ASC', [negotiationId]);
        return rows;
    }
    async findById(id) {
        const [rows] = await connection_1.default.query('SELECT * FROM negotiation_documents WHERE id = ?', [id]);
        if (rows.length === 0)
            return null;
        return rows[0];
    }
    async updateStatus(id, status, comment, reviewerUserId, conn) {
        const db = conn || connection_1.default;
        await db.query(`UPDATE negotiation_documents 
       SET status = ?, review_comment = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
       WHERE id = ?`, [status, comment, reviewerUserId, id]);
    }
}
exports.NegotiationDocumentsRepository = NegotiationDocumentsRepository;
