"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommissionSplitsRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class CommissionSplitsRepository {
    db;
    constructor(db = connection_1.default) {
        this.db = db;
    }
    async replaceForSubmission(params) {
        await this.db.query('DELETE FROM commission_splits WHERE close_submission_id = ?', [params.closeSubmissionId]);
        for (const split of params.splits) {
            await this.db.query(`
        INSERT INTO commission_splits (
          close_submission_id,
          split_role,
          recipient_user_id,
          percent_value,
          amount_value
        ) VALUES (?, ?, ?, ?, ?)
        `, [
                params.closeSubmissionId,
                split.splitRole,
                split.recipientUserId,
                split.percentValue,
                split.amountValue,
            ]);
        }
    }
    async listBySubmissionId(closeSubmissionId) {
        const [rows] = await this.db.query('SELECT * FROM commission_splits WHERE close_submission_id = ? ORDER BY id ASC', [closeSubmissionId]);
        return rows;
    }
}
exports.CommissionSplitsRepository = CommissionSplitsRepository;
