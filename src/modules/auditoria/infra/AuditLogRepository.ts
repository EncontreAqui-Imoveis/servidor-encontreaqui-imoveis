import connection from '../../../database/connection';
import { PoolConnection } from 'mysql2/promise';

export class AuditLogRepository {
  async create(data: {
    entity_type: string;
    entity_id: number;
    action: string;
    performed_by_user_id: number;
    metadata?: any;
  }, conn?: PoolConnection): Promise<void> {
    const db = conn || connection;
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, performed_by_user_id, metadata_json)
       VALUES (?, ?, ?, ?, ?)`,
      [data.entity_type, data.entity_id, data.action, data.performed_by_user_id, JSON.stringify(data.metadata || {})]
    );
  }
}
