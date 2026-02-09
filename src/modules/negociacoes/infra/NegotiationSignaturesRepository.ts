import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import connection from '../../../database/connection';
import { NegotiationSignatureRow, SignatureRole, SignatureValidationStatus } from './types';

export class NegotiationSignaturesRepository {

  async create(
    data: {
      negotiation_id: number;
      signed_by_role: SignatureRole;
      signed_file_url: string;
      signed_proof_image_url?: string;
      signed_by_user_id?: number;
    },
    conn?: PoolConnection
  ): Promise<number> {
    const db = conn || connection;
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO negotiation_signatures 
       (negotiation_id, signed_by_role, signed_file_url, signed_proof_image_url, signed_by_user_id, validation_status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [data.negotiation_id, data.signed_by_role, data.signed_file_url, data.signed_proof_image_url || null, data.signed_by_user_id || null]
    );
    return result.insertId;
  }

  async findByNegotiationId(negotiationId: number): Promise<NegotiationSignatureRow[]> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_signatures WHERE negotiation_id = ?',
      [negotiationId]
    );
    return rows as NegotiationSignatureRow[];
  }

  async findById(id: number): Promise<NegotiationSignatureRow | null> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_signatures WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationSignatureRow;
  }

  async updateValidation(
    id: number,
    status: SignatureValidationStatus,
    comment: string | null,
    adminId: number,
    conn?: PoolConnection
  ): Promise<void> {
    const db = conn || connection;
    await db.query(
      `UPDATE negotiation_signatures 
       SET validation_status = ?, validation_comment = ?, validated_by_admin_id = ?, validated_at = NOW()
       WHERE id = ?`,
      [status, comment, adminId, id]
    );
  }
}
