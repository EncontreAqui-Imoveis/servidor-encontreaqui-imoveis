"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogRepository = void 0;
const connection_1 = __importDefault(require("../../../database/connection"));
class AuditLogRepository {
    async append(data, conn) {
        const db = conn || connection_1.default;
        await db.query(`INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`, [
            data.entityType,
            data.entityId,
            data.action,
            data.performedByUserId,
            data.metadata ? JSON.stringify(data.metadata) : null,
        ]);
    }
    async create(data, conn) {
        const db = conn || connection_1.default;
        await db.query(`INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`, [data.entity_type, data.entity_id, data.action, data.performed_by_user_id, JSON.stringify(data.metadata || {})]);
    }
}
exports.AuditLogRepository = AuditLogRepository;
