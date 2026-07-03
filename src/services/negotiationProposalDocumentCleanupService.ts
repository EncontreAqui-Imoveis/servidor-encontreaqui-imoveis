import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import { enqueueNegotiationDocumentDeletion } from './negotiationDocumentDeletionService';

type ProposalDocumentRow = RowDataPacket & {
  id: number;
  negotiation_id: string;
  type: string;
  document_type: string | null;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
};

export async function purgeNegotiationProposalDocuments(
  tx: PoolConnection,
  negotiationId: string,
  options?: {
    keepDocumentId?: number | null;
    requestedByUserId?: number | null;
    requestSource?: string | null;
  }
): Promise<number> {
  const [rows] = await tx.query<ProposalDocumentRow[]>(
    `
      SELECT
        id,
        negotiation_id,
        type,
        document_type,
        storage_provider,
        storage_bucket,
        storage_key
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND type = 'proposal'
      ORDER BY created_at DESC, id DESC
    `,
    [negotiationId]
  );

  let removedCount = 0;
  const keepDocumentId = Number(options?.keepDocumentId ?? 0);

  for (const row of rows) {
    if (Number.isFinite(keepDocumentId) && keepDocumentId > 0 && Number(row.id) === keepDocumentId) {
      continue;
    }

    await enqueueNegotiationDocumentDeletion(tx, row, {
      negotiationId,
      requestedByUserId: options?.requestedByUserId ?? null,
      requestSource: options?.requestSource ?? null,
    });
    await tx.query('DELETE FROM negotiation_documents WHERE id = ?', [row.id]);
    removedCount += 1;
  }

  return removedCount;
}
