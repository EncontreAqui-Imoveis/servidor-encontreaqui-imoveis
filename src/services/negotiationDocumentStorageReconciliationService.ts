import crypto from 'crypto';
import { RowDataPacket } from 'mysql2';

import connection from '../database/connection';
import {
  deleteManagedNegotiationDocumentStorageObject,
  listManagedNegotiationDocumentStorageObjects,
} from './negotiationDocumentStorageService';

type StoredDocumentReferenceRow = RowDataPacket & {
  id: number;
  negotiation_id: string;
  storage_bucket: string;
  storage_key: string;
};

export type NegotiationDocumentStorageReconciliationResult = {
  databaseReferences: number;
  storageObjects: number;
  missingStorageObjects: Array<{
    documentId: number;
    negotiationId: string;
    storageKeyFingerprint: string;
  }>;
  orphanStorageObjects: Array<{
    storageKeyFingerprint: string;
    sizeBytes: number;
  }>;
  deletedOrphanObjects: number;
  failedOrphanDeletions: number;
};

function fingerprintStorageKey(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Reconciles document references with the R2 prefix used by this application.
 * It is read-only unless deleteOrphans is explicitly enabled by the caller.
 * Reports intentionally contain a key fingerprint instead of the raw key.
 */
export async function reconcileNegotiationDocumentStorage(params?: {
  deleteOrphans?: boolean;
  allowEmptyDatabaseDelete?: boolean;
}): Promise<NegotiationDocumentStorageReconciliationResult> {
  const storageObjects = await listManagedNegotiationDocumentStorageObjects();
  const buckets = Array.from(new Set(storageObjects.map((object) => object.bucket)));
  const storageBucket = buckets[0] ?? String(process.env.R2_BUCKET ?? '').trim();

  const [referenceRows] = await connection.query<StoredDocumentReferenceRow[]>(
    `
      SELECT id, negotiation_id, storage_bucket, storage_key
      FROM negotiation_documents
      WHERE UPPER(COALESCE(storage_provider, '')) = 'R2'
        AND storage_bucket = ?
        AND storage_key IS NOT NULL
        AND TRIM(storage_key) <> ''
    `,
    [storageBucket]
  );

  const objectKeys = new Set(storageObjects.map((object) => object.key));
  const referenceKeys = new Set(referenceRows.map((row) => String(row.storage_key)));
  const missingStorageObjects = referenceRows
    .filter((row) => !objectKeys.has(String(row.storage_key)))
    .map((row) => ({
      documentId: Number(row.id),
      negotiationId: String(row.negotiation_id),
      storageKeyFingerprint: fingerprintStorageKey(String(row.storage_key)),
    }));
  const orphanObjects = storageObjects.filter((object) => !referenceKeys.has(object.key));

  let deletedOrphanObjects = 0;
  let failedOrphanDeletions = 0;
  if (params?.deleteOrphans) {
    if (process.env.R2_RECONCILIATION_CONFIRM !== 'DELETE_ORPHANS') {
      throw new Error(
        'Recusado: R2_RECONCILIATION_CONFIRM=DELETE_ORPHANS é obrigatório para excluir objetos órfãos.'
      );
    }
    if (referenceRows.length === 0 && orphanObjects.length > 0 && !params.allowEmptyDatabaseDelete) {
      throw new Error(
        'Recusado: o banco não possui referências de documentos. Confirme explicitamente antes de excluir todo o prefixo gerenciado.'
      );
    }
    for (const object of orphanObjects) {
      try {
        await deleteManagedNegotiationDocumentStorageObject(object);
        deletedOrphanObjects += 1;
      } catch (error) {
        failedOrphanDeletions += 1;
        console.error('Falha ao excluir objeto órfão do R2.', {
          storageKeyFingerprint: fingerprintStorageKey(object.key),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    databaseReferences: referenceRows.length,
    storageObjects: storageObjects.length,
    missingStorageObjects,
    orphanStorageObjects: orphanObjects.map((object) => ({
      storageKeyFingerprint: fingerprintStorageKey(object.key),
      sizeBytes: object.sizeBytes,
    })),
    deletedOrphanObjects,
    failedOrphanDeletions,
  };
}
