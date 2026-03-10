import type {
  NegotiationDocumentsRepository as NegotiationDocumentsRepositoryPort,
} from '../domain/states/NegotiationState';
import type { SqlExecutor } from './NegotiationRepository';
import {
  parseNegotiationDocumentMetadata,
  readNegotiationDocumentObject,
  storeNegotiationDocumentToR2,
  type StoredNegotiationDocumentRow,
} from '../../../services/negotiationDocumentStorageService';

interface CountRow {
  pending_or_rejected: number | null;
  approved: number | null;
}

interface NegotiationDocumentRow extends StoredNegotiationDocumentRow {
  id: number;
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

    const rows = toRows<CountRow>(
      await executor.execute<CountRow[]>(sql, [params.negotiationId])
    );

    const row = rows?.[0];

    return {
      pendingOrRejected: Number(row?.pending_or_rejected ?? 0),
      approved: Number(row?.approved ?? 0),
    };
  }

  async findById(
    documentId: number,
    trx?: SqlExecutor
  ): Promise<{
    negotiationId: string;
    fileContent: Buffer;
    type: string;
    documentType: string | null;
    metadataJson: Record<string, unknown>;
  } | null> {
    const executor = trx ?? this.executor;
    const sql = `
      SELECT
        negotiation_id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key,
        storage_content_type,
        storage_size_bytes,
        storage_etag
      FROM negotiation_documents
      WHERE id = ?
      LIMIT 1
    `;

    const rows = toRows<NegotiationDocumentRow>(
      await executor.execute<NegotiationDocumentRow[]>(sql, [documentId])
    );
    const row = rows?.[0];
    if (!row) {
      return null;
    }

    return {
      negotiationId: String(row.negotiation_id),
      fileContent: await readNegotiationDocumentObject(row),
      type: row.type,
      documentType: row.document_type ?? null,
      metadataJson: parseNegotiationDocumentMetadata(row.metadata_json),
    };
  }

  async saveProposal(
    negotiationId: string,
    pdfBuffer: Buffer,
    trx?: SqlExecutor,
    metadataJson?: Record<string, unknown> | null
  ): Promise<number> {
    const executor = trx ?? this.executor;

    return storeNegotiationDocumentToR2({
      executor,
      negotiationId,
      type: 'proposal',
      documentType: 'contrato_minuta',
      content: pdfBuffer,
      metadataJson:
        metadataJson ?? {
          originalFileName: 'proposta.pdf',
          generated: true,
        },
    });
  }

  async saveSignedProposal(
    negotiationId: string,
    pdfBuffer: Buffer,
    trx?: SqlExecutor,
    metadataJson?: Record<string, unknown> | null
  ): Promise<number> {
    const executor = trx ?? this.executor;

    return storeNegotiationDocumentToR2({
      executor,
      negotiationId,
      type: 'other',
      documentType: 'contrato_assinado',
      content: pdfBuffer,
      metadataJson:
        metadataJson ?? {
          originalFileName: 'proposta_assinada.pdf',
        },
    });
  }

  async findLatestByNegotiationAndType(
    negotiationId: string,
    type: 'proposal' | 'contract' | 'other',
    trx?: SqlExecutor
  ): Promise<{ id: number; fileContent: Buffer; type: string } | null> {
    const executor = trx ?? this.executor;
    const sql = `
      SELECT
        id,
        negotiation_id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key,
        storage_content_type,
        storage_size_bytes,
        storage_etag
      FROM negotiation_documents
      WHERE negotiation_id = ? AND type = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;

    const rows = toRows<NegotiationDocumentRow>(
      await executor.execute<NegotiationDocumentRow[]>(sql, [negotiationId, type])
    );
    const row = rows?.[0];
    if (!row) {
      return null;
    }

    return {
      id: Number(row.id),
      fileContent: await readNegotiationDocumentObject(row),
      type: row.type,
    };
  }
}
