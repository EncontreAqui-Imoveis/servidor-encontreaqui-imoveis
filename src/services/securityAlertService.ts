import type { RowDataPacket } from 'mysql2';

import connection from '../database/connection';

const WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 60 * 1000;
const THRESHOLDS: Record<string, number> = {
  AUTH_LOGIN_DENIED: 20,
  AUTHORIZATION_DENIED: 50,
  RATE_LIMITED: 20,
  SERVER_ERROR: 5,
};

type EventCountRow = RowDataPacket & { event_type: string; total: number | string };

let alertTimer: NodeJS.Timeout | null = null;
let alertWorkerRunning = false;
let failureReported = false;
const emittedWindows = new Set<string>();

function isEnabled(value = process.env.SECURITY_ALERTS_ENABLED): boolean {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function resolveIntervalMs(value = process.env.SECURITY_ALERT_INTERVAL_MS): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.min(15 * 60 * 1000, Math.max(DEFAULT_INTERVAL_MS, Math.trunc(parsed)));
}

export function findSecurityAlertThresholdBreaches(
  rows: Array<{ event_type: string; total: number | string }>,
): Array<{ eventType: string; total: number; threshold: number }> {
  return rows.flatMap((row) => {
    const threshold = THRESHOLDS[row.event_type];
    const total = Number(row.total);
    if (!threshold || !Number.isFinite(total) || total < threshold) return [];
    return [{ eventType: row.event_type, total, threshold }];
  });
}

export async function checkSecurityAlerts(now = new Date()): Promise<void> {
  const cutoffAt = new Date(now.getTime() - WINDOW_MS);
  try {
    const [rows] = await connection.query<EventCountRow[]>(
      `
        SELECT event_type, COUNT(*) AS total
        FROM security_audit_events
        WHERE created_at >= ?
          AND event_type IN ('AUTH_LOGIN_DENIED', 'AUTHORIZATION_DENIED', 'RATE_LIMITED', 'SERVER_ERROR')
        GROUP BY event_type
      `,
      [cutoffAt],
    );
    failureReported = false;
    const windowKey = Math.floor(now.getTime() / WINDOW_MS);
    for (const breach of findSecurityAlertThresholdBreaches(rows)) {
      const key = `${windowKey}:${breach.eventType}`;
      if (emittedWindows.has(key)) continue;
      emittedWindows.add(key);
      console.error('SECURITY_ALERT_THRESHOLD_EXCEEDED', {
        eventType: breach.eventType,
        total: breach.total,
        threshold: breach.threshold,
        windowSeconds: WINDOW_MS / 1000,
      });
    }
    if (emittedWindows.size > 64) {
      const oldestWindow = windowKey - 1;
      for (const key of emittedWindows) {
        if (Number(key.split(':', 1)[0]) < oldestWindow) emittedWindows.delete(key);
      }
    }
  } catch (error) {
    if (!failureReported) {
      failureReported = true;
      console.error('SECURITY_ALERT_CHECK_FAILED', {
        message: error instanceof Error ? error.message : 'Erro não identificado',
      });
    }
  }
}

export function setupSecurityAlertWorker(): (() => void) | null {
  if (!isEnabled()) return null;
  if (alertTimer) return () => undefined;

  const tick = () => {
    if (alertWorkerRunning) return;
    alertWorkerRunning = true;
    void checkSecurityAlerts().finally(() => {
      alertWorkerRunning = false;
    });
  };

  tick();
  alertTimer = setInterval(tick, resolveIntervalMs());
  return () => {
    if (alertTimer) {
      clearInterval(alertTimer);
      alertTimer = null;
    }
  };
}
