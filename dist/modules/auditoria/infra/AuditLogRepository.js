"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class AuditLogRepository {
    async append(input) {
        const [result] = await connection_1.default.query(`
      INSERT INTO audit_logs (
        entity_type,
        entity_id,
        action,
        performed_by_user_id,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, NOW())
      `, [
            input.entityType,
            input.entityId,
            input.action,
            input.performedByUserId,
            input.metadata ? JSON.stringify(input.metadata) : null,
        ]);
        return result.insertId;
    }
}
exports.AuditLogRepository = AuditLogRepository;
