import { PoolConnection } from 'mysql2/promise';
import connection from '../../../database/connection';
import { CommissionSplitRow, SplitRole } from './types';

export class CommissionSplitsRepository {

  async create(
    data: {
      close_submission_id: number;
      split_role: SplitRole;
      recipient_user_id: number | null;
      percent_value: number | null;
      amount_value: number | null;
    },
    conn?: PoolConnection
  ): Promise<void> {
    const db = conn || connection;
    await db.query(
      `INSERT INTO commission_splits 
       (close_submission_id, split_role, recipient_user_id, percent_value, amount_value)
       VALUES (?, ?, ?, ?, ?)`,
      [data.close_submission_id, data.split_role, data.recipient_user_id, data.percent_value, data.amount_value]
    );
  }

  async findBySubmissionId(submissionId: number): Promise<CommissionSplitRow[]> {
    const [rows] = await connection.query<any[]>(
      'SELECT * FROM commission_splits WHERE close_submission_id = ?',
      [submissionId]
    );
    return rows as CommissionSplitRow[];
  }
}
