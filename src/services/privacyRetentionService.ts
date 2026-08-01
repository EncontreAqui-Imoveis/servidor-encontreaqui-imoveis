import type { ResultSetHeader } from 'mysql2';

import connection from '../database/connection';

const DEFAULT_NOTIFICATION_RETENTION_DAYS = 180;
const DEFAULT_SECURITY_AUDIT_RETENTION_DAYS = 180;
const DEFAULT_BATCH_SIZE = 250;
const DEFAULT_WORKER_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_BATCHES_PER_RUN = 20;

let retentionWorkerTimer: NodeJS.Timeout | null = null;
let retentionWorkerRunning = false;

function isTrue(value: unknown): boolean {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function isDataRetentionWorkerEnabled(): boolean {
  return isTrue(process.env.DATA_RETENTION_WORKER_ENABLED);
}

export function resolveNotificationRetentionDays(value = process.env.NOTIFICATION_RETENTION_DAYS): number {
  return boundedInteger(value, DEFAULT_NOTIFICATION_RETENTION_DAYS, 30, 3650);
}

export function resolveSecurityAuditRetentionDays(value = process.env.SECURITY_AUDIT_RETENTION_DAYS): number {
  return boundedInteger(value, DEFAULT_SECURITY_AUDIT_RETENTION_DAYS, 30, 3650);
}

function resolveBatchSize(value = process.env.DATA_RETENTION_BATCH_SIZE): number {
  return boundedInteger(value, DEFAULT_BATCH_SIZE, 1, 1000);
}

function toErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '').trim();
    if (code) return code.slice(0, 120);
  }
  return 'RETENTION_NOTIFICATION_PURGE_FAILED';
}

async function recordRetentionRun(input: {
  jobName: string;
  status: 'SUCCESS' | 'FAILED';
  cutoffAt: Date;
  deletedCount: number;
  errorCode?: string | null;
}): Promise<void> {
  await connection.query(
    `
      INSERT INTO privacy_retention_runs (
        job_name, status, cutoff_at, deleted_count, error_code, completed_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [input.jobName, input.status, input.cutoffAt, input.deletedCount, input.errorCode ?? null]
  );
}

export async function purgeExpiredNotifications(now = new Date()): Promise<{
  cutoffAt: Date;
  deletedCount: number;
}> {
  const retentionDays = resolveNotificationRetentionDays();
  const cutoffAt = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const batchSize = resolveBatchSize();
  let deletedCount = 0;

  try {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM notifications WHERE created_at < ? LIMIT ?',
        [cutoffAt, batchSize]
      );
      const affectedRows = Number(result.affectedRows ?? 0);
      deletedCount += affectedRows;
      if (affectedRows < batchSize) break;
    }
    await recordRetentionRun({ jobName: 'notifications', status: 'SUCCESS', cutoffAt, deletedCount });
    return { cutoffAt, deletedCount };
  } catch (error) {
    try {
      await recordRetentionRun({
        jobName: 'notifications',
        status: 'FAILED',
        cutoffAt,
        deletedCount,
        errorCode: toErrorCode(error),
      });
    } catch {
      // Do not hide the original retention failure when audit persistence is unavailable.
    }
    throw error;
  }
}

export async function purgeExpiredSecurityAuditEvents(now = new Date()): Promise<{
  cutoffAt: Date;
  deletedCount: number;
}> {
  const retentionDays = resolveSecurityAuditRetentionDays();
  const cutoffAt = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const batchSize = resolveBatchSize();
  let deletedCount = 0;

  try {
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const [result] = await connection.query<ResultSetHeader>(
        'DELETE FROM security_audit_events WHERE created_at < ? LIMIT ?',
        [cutoffAt, batchSize],
      );
      const affectedRows = Number(result.affectedRows ?? 0);
      deletedCount += affectedRows;
      if (affectedRows < batchSize) break;
    }
    await recordRetentionRun({ jobName: 'security_audit_events', status: 'SUCCESS', cutoffAt, deletedCount });
    return { cutoffAt, deletedCount };
  } catch (error) {
    try {
      await recordRetentionRun({
        jobName: 'security_audit_events',
        status: 'FAILED',
        cutoffAt,
        deletedCount,
        errorCode: toErrorCode(error),
      });
    } catch {
      // Preserve the original audit-retention failure for the caller.
    }
    throw error;
  }
}

export function setupPrivacyRetentionWorker(
  intervalMs = DEFAULT_WORKER_INTERVAL_MS
): (() => void) | null {
  if (!isDataRetentionWorkerEnabled()) return null;
  if (retentionWorkerTimer) return () => undefined;

  const tick = () => {
    if (retentionWorkerRunning) return;
    retentionWorkerRunning = true;
    void Promise.allSettled([purgeExpiredNotifications(), purgeExpiredSecurityAuditEvents()])
      .then((results) => {
        const [notifications, securityAudit] = results;
        if (notifications.status === 'fulfilled' && notifications.value.deletedCount > 0) {
          console.info('Retencao de notificacoes concluida.', { deletedCount: notifications.value.deletedCount });
        }
        if (securityAudit.status === 'fulfilled' && securityAudit.value.deletedCount > 0) {
          console.info('Retencao de auditoria de seguranca concluida.', { deletedCount: securityAudit.value.deletedCount });
        }
        if (notifications.status === 'rejected') {
          console.error('Falha na retencao de notificacoes.', { code: toErrorCode(notifications.reason) });
        }
        if (securityAudit.status === 'rejected') {
          console.error('Falha na retencao de auditoria de seguranca.', { code: toErrorCode(securityAudit.reason) });
        }
      })
      .finally(() => {
        retentionWorkerRunning = false;
      });
  };

  tick();
  retentionWorkerTimer = setInterval(tick, intervalMs);
  return () => {
    if (retentionWorkerTimer) {
      clearInterval(retentionWorkerTimer);
      retentionWorkerTimer = null;
    }
  };
}
