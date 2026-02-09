import connection from '../../../database/connection';
import { PoolConnection } from 'mysql2/promise';

export class AuditLogRepository {
  async append(data: {
    entityType: string;
    entityId: number;
    action: string;
    performedByUserId: number;
    metadata?: Record<string, unknown>;
  }, conn?: PoolConnection): Promise<void> {
    const db = conn || connection;
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [
        data.entityType,
        data.entityId,
        data.action,
        data.performedByUserId,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
  }

  async create(data: {
    entity_type: string;
    entity_id: number;
    action: string;
    performed_by_user_id: number;
    metadata?: any;
  }, conn?: PoolConnection): Promise<void> {
    const db = conn || connection;
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [data.entity_type, data.entity_id, data.action, data.performed_by_user_id, JSON.stringify(data.metadata || {})]
    );
  }
}
