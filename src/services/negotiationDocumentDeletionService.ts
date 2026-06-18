import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

import connection from '../database/connection';
import {
  deleteNegotiationDocumentObject,
  type StoredNegotiationDocumentRow,
} from './negotiationDocumentStorageService';

type NegotiationDocumentDeletionJobRow = RowDataPacket & {
  id: number;
  negotiation_document_id: number | null;
  negotiation_id: string;
  document_type: string | null;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string;
  requested_by_user_id: number | null;
  request_source: string | null;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  attempts: number;
  last_error: string | null;
};

const DEFAULT_WORKER_INTERVAL_MS = 15_000;
const MAX_BACKOFF_SECONDS = 3_600;

let deletionWorkerTimer: NodeJS.Timeout | null = null;
let deletionWorkerRunning = false;

function toStoredDocumentParams(
  document: {
    id?: number | string | null;
    document_type?: string | null;
    storage_provider?: string | null;
    storage_bucket?: string | null;
    storage_key?: string | null;
  }
): {
  negotiationDocumentId: number | null;
  documentType: string | null;
  storageProvider: string;
  storageBucket: string;
  storageKey: string;
} {
  return {
    negotiationDocumentId: Number.isInteger(Number(document.id ?? 0)) ? Number(document.id ?? 0) : null,
    documentType: String(document.document_type ?? '').trim() || null,
    storageProvider: String(document.storage_provider ?? '').trim(),
    storageBucket: String(document.storage_bucket ?? '').trim(),
    storageKey: String(document.storage_key ?? '').trim(),
  };
}

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1
    `,
    [tableName]
  );
  return rows.length > 0;
}

async function hasDeletionJobsTable(): Promise<boolean> {
  return tableExists('negotiation_document_deletion_jobs');
}

function normalizeDeleteError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 1000);
  }
  return String(error ?? 'Falha desconhecida ao excluir objeto do storage.').slice(0, 1000);
}

function backoffSeconds(attempts: number): number {
  const raw = Math.min(2 ** Math.max(attempts - 1, 0) * 30, MAX_BACKOFF_SECONDS);
  return Math.max(raw, 30);
}

export async function enqueueNegotiationDocumentDeletion(
  tx: PoolConnection,
  document: {
    id?: number | string | null;
    document_type?: string | null;
    storage_provider?: string | null;
    storage_bucket?: string | null;
    storage_key?: string | null;
  },
  context?: {
    negotiationId?: string;
    requestedByUserId?: number | null;
    requestSource?: string | null;
  }
): Promise<void> {
  const hasTable = await hasDeletionJobsTable();
  if (!hasTable) {
    throw new Error('Tabela de fila de deleção de documentos não encontrada.');
  }

  const row = toStoredDocumentParams(document);
  const negotiationId = String(context?.negotiationId ?? '').trim();
  if (!negotiationId || !row.storageProvider || !row.storageBucket || !row.storageKey) {
    throw new Error('Documento sem metadados suficientes para fila de deleção.');
  }

  await tx.query(
    `
      INSERT INTO negotiation_document_deletion_jobs (
        negotiation_document_id,
        negotiation_id,
        document_type,
        storage_provider,
        storage_bucket,
        storage_key,
        requested_by_user_id,
        request_source,
        status,
        attempts,
        last_error,
        available_at,
        processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, NULL, CURRENT_TIMESTAMP, NULL)
      ON DUPLICATE KEY UPDATE
        negotiation_document_id = VALUES(negotiation_document_id),
        negotiation_id = VALUES(negotiation_id),
        document_type = VALUES(document_type),
        storage_provider = VALUES(storage_provider),
        storage_bucket = VALUES(storage_bucket),
        requested_by_user_id = VALUES(requested_by_user_id),
        request_source = VALUES(request_source),
        status = 'PENDING',
        attempts = 0,
        last_error = NULL,
        available_at = CURRENT_TIMESTAMP,
        processed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      row.negotiationDocumentId,
      negotiationId,
      row.documentType,
      row.storageProvider,
      row.storageBucket,
      row.storageKey,
      context?.requestedByUserId ?? null,
      context?.requestSource ?? null,
    ]
  );
}

async function claimNextDeletionJob(
  tx: PoolConnection
): Promise<NegotiationDocumentDeletionJobRow | null> {
  const [rows] = await tx.query<NegotiationDocumentDeletionJobRow[]>(
    `
      SELECT
        id,
        negotiation_document_id,
        negotiation_id,
        document_type,
        storage_provider,
        storage_bucket,
        storage_key,
        requested_by_user_id,
        request_source,
        status,
        attempts,
        last_error
      FROM negotiation_document_deletion_jobs
      WHERE status IN ('PENDING', 'FAILED')
        AND available_at <= CURRENT_TIMESTAMP
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
    `
  );

  const job = rows[0];
  if (!job) {
    return null;
  }

  await tx.query(
    `
      UPDATE negotiation_document_deletion_jobs
      SET
        status = 'PROCESSING',
        attempts = attempts + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [job.id]
  );

  return {
    ...job,
    status: 'PROCESSING',
    attempts: Number(job.attempts ?? 0) + 1,
  };
}

async function markDeletionJobDone(jobId: number): Promise<void> {
  await connection.query(
    `
      UPDATE negotiation_document_deletion_jobs
      SET
        status = 'DONE',
        last_error = NULL,
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [jobId]
  );
}

async function markDeletionJobFailed(jobId: number, attempts: number, error: unknown): Promise<void> {
  const retryAt = new Date(Date.now() + backoffSeconds(attempts) * 1000);
  await connection.query(
    `
      UPDATE negotiation_document_deletion_jobs
      SET
        status = 'FAILED',
        last_error = ?,
        available_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [normalizeDeleteError(error), retryAt, jobId]
  );
}

export async function processPendingNegotiationDocumentDeletionJobs(
  limit = 10
): Promise<{ processed: number; failed: number }> {
  if (deletionWorkerRunning) {
    return { processed: 0, failed: 0 };
  }

  if (!(await hasDeletionJobsTable())) {
    return { processed: 0, failed: 0 };
  }

  deletionWorkerRunning = true;
  let processed = 0;
  let failed = 0;

  try {
    for (let index = 0; index < limit; index += 1) {
      const tx = await connection.getConnection();
      let job: NegotiationDocumentDeletionJobRow | null = null;
      try {
        await tx.beginTransaction();
        job = await claimNextDeletionJob(tx);
        await tx.commit();
      } catch (error) {
        await tx.rollback();
        throw error;
      } finally {
        tx.release();
      }

      if (!job) {
        break;
      }

      try {
        await deleteNegotiationDocumentObject({
          storage_provider: job.storage_provider,
          storage_bucket: job.storage_bucket,
          storage_key: job.storage_key,
        });
        await markDeletionJobDone(job.id);
        processed += 1;
      } catch (error) {
        failed += 1;
        await markDeletionJobFailed(job.id, Number(job.attempts ?? 1), error);
        console.error('Falha ao excluir documento do storage R2; job reagendado.', {
          jobId: job.id,
          negotiationId: job.negotiation_id,
          documentType: job.document_type ?? null,
          storageKey: job.storage_key,
          error,
        });
      }
    }
  } finally {
    deletionWorkerRunning = false;
  }

  return { processed, failed };
}

export function setupNegotiationDocumentDeletionWorker(intervalMs = DEFAULT_WORKER_INTERVAL_MS): (() => void) | null {
  if (deletionWorkerTimer) {
    return () => {
      if (deletionWorkerTimer) {
        clearInterval(deletionWorkerTimer);
        deletionWorkerTimer = null;
      }
    };
  }

  const tick = () => {
    void processPendingNegotiationDocumentDeletionJobs().catch((error) => {
      console.error('Erro ao processar fila de deleção de documentos de negociação:', error);
    });
  };

  tick();
  deletionWorkerTimer = setInterval(tick, intervalMs);
  return () => {
    if (deletionWorkerTimer) {
      clearInterval(deletionWorkerTimer);
      deletionWorkerTimer = null;
    }
  };
}
