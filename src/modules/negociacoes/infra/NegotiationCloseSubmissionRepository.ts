import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import connection from '../../../database/connection';
import { NegotiationCloseSubmissionRow, CloseType, CommissionMode } from './types';

export class NegotiationCloseSubmissionRepository {

  async create(
    data: {
      negotiation_id: number;
      close_type: CloseType;
      commission_mode: CommissionMode;
      commission_total_percent?: number;
      commission_total_amount?: number;
      payment_proof_url: string;
      submitted_by_user_id: number;
      no_commission_reason?: string;
    },
    conn?: PoolConnection
  ): Promise<number> {
    const db = conn || connection;
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO negotiation_close_submissions 
       (negotiation_id, close_type, commission_mode, commission_total_percent, commission_total_amount, payment_proof_url, submitted_by_user_id, no_commission_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [data.negotiation_id, data.close_type, data.commission_mode, data.commission_total_percent || null, data.commission_total_amount || null, data.payment_proof_url, data.submitted_by_user_id, data.no_commission_reason || null]
    );
    return result.insertId;
  }

  async findByNegotiationId(negotiationId: number): Promise<NegotiationCloseSubmissionRow | null> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_close_submissions WHERE negotiation_id = ? ORDER BY created_at DESC LIMIT 1',
      [negotiationId]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationCloseSubmissionRow;
  }

  async findById(id: number): Promise<NegotiationCloseSubmissionRow | null> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_close_submissions WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationCloseSubmissionRow;
  }

  async approve(
    id: number,
    adminId: number,
    conn?: PoolConnection
  ): Promise<void> {
    const db = conn || connection;
    await db.query(
      `UPDATE negotiation_close_submissions 
       SET approved_by_admin_id = ?, approved_at = NOW()
       WHERE id = ?`,
      [adminId, id]
    );
  }
}
