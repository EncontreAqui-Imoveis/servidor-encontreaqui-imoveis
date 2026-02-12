import { ConflictError } from '../domain/errors/ConflictError';
import { NegotiationsRepository, NegotiationStatus, PaymentDetails } from '../domain/states/NegotiationState';

export interface SqlResultHeader {
  affectedRows?: number;
}

export interface SqlExecutor {
  execute<T = SqlResultHeader>(sql: string, params?: unknown[]): Promise<T | [T, unknown]>;
}

const toAffectedRows = (result: SqlResultHeader | [SqlResultHeader, unknown]): number => {
  const header = Array.isArray(result) ? result[0] : result;
  return header?.affectedRows ?? 0;
};

export class NegotiationRepository implements NegotiationsRepository<SqlExecutor> {
  async updateStatusWithOptimisticLock(params: {
    id: string;
    fromStatus: NegotiationStatus;
    toStatus: NegotiationStatus;
    expectedVersion: number;
    actorId: number;
    metadata?: Record<string, unknown> | null;
    trx: SqlExecutor;
  }): Promise<void> {
    const updateSql = `
      UPDATE negotiations
      SET status = ?, version = version + 1
      WHERE id = ? AND version = ? AND status = ?
    `;

    const updateResult = await params.trx.execute<SqlResultHeader>(updateSql, [
      params.toStatus,
      params.id,
      params.expectedVersion,
      params.fromStatus,
    ]);

    if (toAffectedRows(updateResult) === 0) {
      throw new ConflictError('Negotiation version conflict.');
    }

    const historySql = `
      INSERT INTO negotiation_history
        (id, negotiation_id, from_status, to_status, actor_id, metadata_json, created_at)
      VALUES
        (UUID(), ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    const metadataJson =
      params.metadata === undefined ? null : JSON.stringify(params.metadata ?? null);

    await params.trx.execute(historySql, [
      params.id,
      params.fromStatus,
      params.toStatus,
      params.actorId,
      metadataJson,
    ]);
  }

  async updateDraftWithOptimisticLock(params: {
    id: string;
    expectedVersion: number;
    paymentDetails: PaymentDetails;
    finalValue: number | null;
    proposalValidityDate: string | null;
    sellingBrokerId: number | null;
    trx: SqlExecutor;
  }): Promise<number> {
    const updateSql = `
      UPDATE negotiations
      SET
        payment_details = ?,
        final_value = ?,
        proposal_validity_date = ?,
        selling_broker_id = ?,
        version = version + 1
      WHERE id = ? AND version = ?
    `;

    const paymentDetailsJson = JSON.stringify(params.paymentDetails);

    const result = await params.trx.execute<SqlResultHeader>(updateSql, [
      paymentDetailsJson,
      params.finalValue,
      params.proposalValidityDate,
      params.sellingBrokerId,
      params.id,
      params.expectedVersion,
    ]);

    return toAffectedRows(result);
  }
}
