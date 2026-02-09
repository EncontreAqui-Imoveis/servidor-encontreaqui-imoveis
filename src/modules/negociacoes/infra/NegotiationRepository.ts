import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import connection from '../../../database/connection';
import { NegotiationRow, NegotiationStatus } from './types';

export class NegotiationRepository {

  async create(
    data: {
      property_id: number;
      captador_user_id: number;
      seller_broker_user_id: number;
      created_by_user_id: number;
    },
    conn?: PoolConnection
  ): Promise<number> {
    const db = conn || connection;
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO negotiations 
       (property_id, captador_user_id, seller_broker_user_id, created_by_user_id, status, active)
       VALUES (?, ?, ?, ?, 'DRAFT', 0)`,
      [data.property_id, data.captador_user_id, data.seller_broker_user_id, data.created_by_user_id]
    );
    return result.insertId;
  }

  async findById(id: number, conn?: PoolConnection): Promise<NegotiationRow | null> {
    const db = conn || connection;
    const [rows] = await db.query<any[]>(
      'SELECT * FROM negotiations WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationRow;
  }

  async findActiveByPropertyId(propertyId: number, conn?: PoolConnection): Promise<NegotiationRow | null> {
    const db = conn || connection;
    const [rows] = await db.query<any[]>(
      'SELECT * FROM negotiations WHERE property_id = ? AND active = 1',
      [propertyId]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationRow;
  }

  // Used for transaction locking to prevent race conditions when activating
  async findActiveByPropertyIdForUpdate(propertyId: number, conn: PoolConnection): Promise<NegotiationRow | null> {
    const [rows] = await conn.query<any[]>(
      'SELECT * FROM negotiations WHERE property_id = ? AND active = 1 FOR UPDATE',
      [propertyId]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationRow;
  }

  async updateStatus(
    id: number,
    status: NegotiationStatus,
    conn?: PoolConnection
  ): Promise<void> {
    const db = conn || connection;
    await db.query(
      'UPDATE negotiations SET status = ? WHERE id = ?',
      [status, id]
    );
  }

  async activate(
    id: number,
    expiresAt: Date,
    conn: PoolConnection
  ): Promise<void> {
    await conn.query(
      `UPDATE negotiations 
       SET active = 1, started_at = NOW(), expires_at = ?, last_activity_at = NOW(), status = 'DOCS_IN_REVIEW'
       WHERE id = ?`,
      [expiresAt, id]
    );
  }

  async deactivate(id: number, status: NegotiationStatus, conn?: PoolConnection): Promise<void> {
    const db = conn || connection;
    await db.query(
      'UPDATE negotiations SET active = 0, status = ? WHERE id = ?',
      [status, id]
    );
  }
}
