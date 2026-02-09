"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationSignaturesRepository = void 0;
const db_1 = require("./db");
class NegotiationSignaturesRepository {
    db;
    constructor(db = (0, db_1.getDefaultQueryRunner)()) {
        this.db = db;
    }
    async create(params) {
        const [result] = await this.db.query(`
      INSERT INTO negotiation_signatures (
        negotiation_id,
        signed_by_role,
        signed_file_url,
        signed_proof_image_url,
        signed_by_user_id,
        validation_status
      ) VALUES (?, ?, ?, ?, ?, 'PENDING')
      `, [
            params.negotiationId,
            params.signedByRole,
            params.signedFileUrl,
            params.signedProofImageUrl,
            params.signedByUserId,
        ]);
        return result.insertId;
    }
    async findById(id) {
        const [rows] = await this.db.query('SELECT * FROM negotiation_signatures WHERE id = ? LIMIT 1', [id]);
        return rows[0] ?? null;
    }
    async listByNegotiationId(negotiationId) {
        const [rows] = await this.db.query('SELECT * FROM negotiation_signatures WHERE negotiation_id = ? ORDER BY created_at DESC', [negotiationId]);
        return rows;
    }
    async validate(params) {
        await this.db.query(`
      UPDATE negotiation_signatures
      SET validation_status = ?, validation_comment = ?, validated_by_admin_id = ?, validated_at = NOW()
      WHERE id = ?
      `, [params.status, params.comment, params.validatedByAdminId, params.id]);
    }
}
exports.NegotiationSignaturesRepository = NegotiationSignaturesRepository;
