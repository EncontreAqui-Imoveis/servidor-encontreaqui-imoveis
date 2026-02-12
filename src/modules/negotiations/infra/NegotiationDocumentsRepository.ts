import type {
  NegotiationDocumentsRepository as NegotiationDocumentsRepositoryPort,
} from '../domain/states/NegotiationState';
import type { SqlExecutor } from './NegotiationRepository';

interface CountRow {
  pending_or_rejected: number | null;
  approved: number | null;
}

interface DocumentRow {
  file_content: Buffer | Uint8Array | null;
  type: string;
}

const toRows = <T>(result: T[] | [T[], unknown]): T[] => {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return result as T[];
};

export class NegotiationDocumentsRepository
  implements NegotiationDocumentsRepositoryPort<SqlExecutor>
{
  private readonly executor: SqlExecutor;

  constructor(executor: SqlExecutor) {
    this.executor = executor;
  }

  async countPendingOrRejected(params: {
    negotiationId: string;
    trx?: SqlExecutor;
  }): Promise<{ pendingOrRejected: number; approved: number }> {
    const executor = params.trx ?? this.executor;

    const sql = `
      SELECT
        SUM(CASE WHEN status IN ('PENDING', 'REJECTED') THEN 1 ELSE 0 END) AS pending_or_rejected,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved
      FROM negotiation_documents
      WHERE negotiation_id = ?
    `;

    const rows = toRows<CountRow>(await executor.execute<CountRow[]>(sql, [params.negotiationId]));

    const row = rows?.[0];

    return {
      pendingOrRejected: Number(row?.pending_or_rejected ?? 0),
      approved: Number(row?.approved ?? 0),
    };
  }

  async findById(
    documentId: number,
    trx?: SqlExecutor
  ): Promise<{ fileContent: Buffer; type: string } | null> {
    const executor = trx ?? this.executor;
    const sql = `
      SELECT file_content, type
      FROM negotiation_documents
      WHERE id = ?
      LIMIT 1
    `;

    const rows = toRows<DocumentRow>(await executor.execute<DocumentRow[]>(sql, [documentId]));
    const row = rows?.[0];
    if (!row?.file_content) {
      return null;
    }

    const fileContent = Buffer.isBuffer(row.file_content)
      ? row.file_content
      : Buffer.from(row.file_content);

    return {
      fileContent,
      type: row.type,
    };
  }

  async saveProposal(
    negotiationId: string,
    pdfBuffer: Buffer,
    trx?: SqlExecutor
  ): Promise<void> {
    const executor = trx ?? this.executor;

    const sql = `
      INSERT INTO negotiation_documents (negotiation_id, type, file_content)
      VALUES (?, 'proposal', ?)
    `;

    await executor.execute(sql, [negotiationId, pdfBuffer]);
  }
}
