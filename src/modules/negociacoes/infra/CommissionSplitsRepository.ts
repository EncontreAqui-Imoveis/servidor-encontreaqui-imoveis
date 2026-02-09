import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';
import connection from '../../../database/connection';
import { CommissionSplitRow } from './types';
import { SplitRole } from '../domain/types';

export class CommissionSplitsRepository {
  constructor(private readonly db: PoolConnection | typeof connection = connection) {}

  async replaceForSubmission(params: {
    closeSubmissionId: number;
    splits: Array<{
      splitRole: SplitRole;
      recipientUserId: number | null;
      percentValue: number | null;
      amountValue: number | null;
    }>;
  }): Promise<void> {
    await this.db.query('DELETE FROM commission_splits WHERE close_submission_id = ?', [params.closeSubmissionId]);

    for (const split of params.splits) {
      await this.db.query<ResultSetHeader>(
        `
        INSERT INTO commission_splits (
          close_submission_id,
          split_role,
          recipient_user_id,
          percent_value,
          amount_value
        ) VALUES (?, ?, ?, ?, ?)
        `,
        [
          params.closeSubmissionId,
          split.splitRole,
          split.recipientUserId,
          split.percentValue,
          split.amountValue,
        ]
      );
    }
  }

  async listBySubmissionId(closeSubmissionId: number): Promise<CommissionSplitRow[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM commission_splits WHERE close_submission_id = ? ORDER BY id ASC',
      [closeSubmissionId]
    );
    return rows as CommissionSplitRow[];
  }
}
