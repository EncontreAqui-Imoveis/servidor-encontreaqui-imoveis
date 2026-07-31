import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../src/database/connection', () => ({
  default: { query },
}));

import {
  isDataRetentionWorkerEnabled,
  purgeExpiredNotifications,
  resolveNotificationRetentionDays,
} from '../../src/services/privacyRetentionService';

describe('privacyRetentionService', () => {
  const originalEnabled = process.env.DATA_RETENTION_WORKER_ENABLED;
  const originalDays = process.env.NOTIFICATION_RETENTION_DAYS;
  const originalBatchSize = process.env.DATA_RETENTION_BATCH_SIZE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_RETENTION_WORKER_ENABLED = originalEnabled;
    process.env.NOTIFICATION_RETENTION_DAYS = originalDays;
    process.env.DATA_RETENTION_BATCH_SIZE = originalBatchSize;
  });

  it('fica desligado sem habilitacao explicita', () => {
    delete process.env.DATA_RETENTION_WORKER_ENABLED;
    expect(isDataRetentionWorkerEnabled()).toBe(false);
  });

  it('mantem 180 dias como padrao e limita valores perigosos', () => {
    delete process.env.NOTIFICATION_RETENTION_DAYS;
    expect(resolveNotificationRetentionDays()).toBe(180);
    expect(resolveNotificationRetentionDays('1')).toBe(30);
    expect(resolveNotificationRetentionDays('99999')).toBe(3650);
  });

  it('remove notificacoes expiradas em lote e registra evidencia sem PII', async () => {
    process.env.NOTIFICATION_RETENTION_DAYS = '180';
    process.env.DATA_RETENTION_BATCH_SIZE = '250';
    query
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);

    const result = await purgeExpiredNotifications(new Date('2026-07-31T12:00:00.000Z'));

    expect(result.deletedCount).toBe(2);
    expect(result.cutoffAt.toISOString()).toBe('2026-02-01T12:00:00.000Z');
    expect(query.mock.calls[0][0]).toContain('DELETE FROM notifications');
    expect(query.mock.calls[1][0]).toContain('INSERT INTO privacy_retention_runs');
    expect(JSON.stringify(query.mock.calls[1][1])).not.toContain('@');
  });
});
