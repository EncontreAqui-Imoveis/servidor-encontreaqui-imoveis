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

interface NegotiationDocumentRow extends DocumentRow {
  id: number;
}

interface InsertResult {
  insertId?: number;
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
  ): Promise<number> {
    const executor = trx ?? this.executor;

    const sql = `
      INSERT INTO negotiation_documents (negotiation_id, type, document_type, file_content)
      VALUES (?, 'proposal', 'contrato_minuta', ?)
    `;

    const result = await executor.execute<InsertResult>(sql, [negotiationId, pdfBuffer]);
    const header = Array.isArray(result) ? result[0] : result;
    return Number(header?.insertId ?? 0);
  }

  async saveSignedProposal(
    negotiationId: string,
    pdfBuffer: Buffer,
    trx?: SqlExecutor
  ): Promise<number> {
    const executor = trx ?? this.executor;

    const sql = `
      INSERT INTO negotiation_documents (negotiation_id, type, document_type, file_content)
      VALUES (?, 'other', 'contrato_assinado', ?)
    `;

    const result = await executor.execute<InsertResult>(sql, [negotiationId, pdfBuffer]);
    const header = Array.isArray(result) ? result[0] : result;
    return Number(header?.insertId ?? 0);
  }

  async findLatestByNegotiationAndType(
    negotiationId: string,
    type: 'proposal' | 'contract' | 'other',
    trx?: SqlExecutor
  ): Promise<{ id: number; fileContent: Buffer; type: string } | null> {
    const executor = trx ?? this.executor;
    const sql = `
      SELECT id, file_content, type
      FROM negotiation_documents
      WHERE negotiation_id = ? AND type = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;

    const rows = toRows<NegotiationDocumentRow>(
      await executor.execute<NegotiationDocumentRow[]>(sql, [negotiationId, type])
    );
    const row = rows?.[0];
    if (!row?.file_content) {
      return null;
    }

    const fileContent = Buffer.isBuffer(row.file_content)
      ? row.file_content
      : Buffer.from(row.file_content);

    return {
      id: Number(row.id),
      fileContent,
      type: row.type,
    };
  }
}
