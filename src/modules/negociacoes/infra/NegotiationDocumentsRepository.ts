import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import connection from '../../../database/connection';
import { NegotiationDocumentRow, DocumentStatus } from './types';

export class NegotiationDocumentsRepository {

  async create(
    data: {
      negotiation_id: number;
      doc_name: string;
      doc_url: string;
      uploaded_by_user_id: number;
    },
    conn?: PoolConnection
  ): Promise<number> {
    const db = conn || connection;
    const [result] = await db.query<ResultSetHeader>(
      `INSERT INTO negotiation_documents 
       (negotiation_id, doc_name, doc_url, uploaded_by_user_id, status)
       VALUES (?, ?, ?, ?, 'PENDING_REVIEW')`,
      [data.negotiation_id, data.doc_name, data.doc_url, data.uploaded_by_user_id]
    );
    return result.insertId;
  }

  async findByNegotiationId(negotiationId: number): Promise<NegotiationDocumentRow[]> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_documents WHERE negotiation_id = ? ORDER BY created_at ASC',
      [negotiationId]
    );
    return rows as NegotiationDocumentRow[];
  }

  async findById(id: number): Promise<NegotiationDocumentRow | null> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM negotiation_documents WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rows[0] as NegotiationDocumentRow;
  }

  async updateStatus(
    id: number,
    status: DocumentStatus,
    comment: string | null,
    reviewerUserId: number,
    conn?: PoolConnection
  ): Promise<void> {
    const db = conn || connection;
    await db.query(
      `UPDATE negotiation_documents 
       SET status = ?, review_comment = ?, reviewed_by_user_id = ?, reviewed_at = NOW()
       WHERE id = ?`,
      [status, comment, reviewerUserId, id]
    );
  }
}
