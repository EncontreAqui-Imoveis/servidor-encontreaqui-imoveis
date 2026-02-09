"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationDocumentsRepository = void 0;
const db_1 = require("./db");
class NegotiationDocumentsRepository {
    db;
    constructor(db = (0, db_1.getDefaultQueryRunner)()) {
        this.db = db;
    }
    async create(params) {
        const [result] = await this.db.query(`
        INSERT INTO negotiation_documents (
          negotiation_id,
          doc_name,
          doc_url,
          status,
          uploaded_by_user_id
        ) VALUES (?, ?, ?, 'PENDING_REVIEW', ?)
      `, [params.negotiationId, params.docName, params.docUrl, params.uploadedByUserId]);
        return result.insertId;
    }
    async findById(id) {
        const [rows] = await this.db.query('SELECT * FROM negotiation_documents WHERE id = ? LIMIT 1', [id]);
        return rows[0] ?? null;
    }
    async listByNegotiationId(negotiationId) {
        const [rows] = await this.db.query('SELECT * FROM negotiation_documents WHERE negotiation_id = ? ORDER BY created_at DESC', [negotiationId]);
        return rows;
    }
    async review(params) {
        await this.db.query(`
      UPDATE negotiation_documents
      SET status = ?, review_comment = ?, reviewed_by_user_id = ?, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ?
      `, [params.status, params.reviewComment, params.reviewedByAdminId, params.id]);
    }
}
exports.NegotiationDocumentsRepository = NegotiationDocumentsRepository;
