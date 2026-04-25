import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnectionMock, txMock, loadUserLifecycleSnapshotMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  return {
    getConnectionMock: vi.fn(),
    txMock: tx,
    loadUserLifecycleSnapshotMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  __esModule: true,
  adminDb: { getConnection: getConnectionMock, query: vi.fn() },
}));

const { notifyUsersMock, resolveUserNotificationRoleMock } = vi.hoisted(() => ({
  notifyUsersMock: vi.fn(),
  resolveUserNotificationRoleMock: vi.fn(),
}));

vi.mock('../../src/services/adminAccountLifecycleService', () => ({
  loadUserLifecycleSnapshot: (db: unknown, id: number, opts?: unknown) =>
    loadUserLifecycleSnapshotMock(db, id, opts),
  isActiveBrokerStatus: (s: unknown) => {
    const t = String(s ?? '')
      .trim()
      .toLowerCase();
    return t === 'pending_verification' || t === 'approved';
  },
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  resolveUserNotificationRole: resolveUserNotificationRoleMock,
  splitRecipientsByRole: vi.fn().mockResolvedValue({ clientIds: [], brokerIds: [] }),
}));

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: vi.fn(),
  notifyAdmins: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(null),
}));

import { adminController } from '../../src/controllers/AdminController';

describe('POST /admin/clients/:id/promote-broker', () => {
  const app = express();
  app.use(express.json());
  app.post('/admin/clients/:id/promote-broker', (req, res) =>
    adminController.promoteClientToBroker(req as any, res),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    notifyUsersMock.mockResolvedValue(null);
    resolveUserNotificationRoleMock.mockResolvedValue('broker');
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
  });

  it('rejects invalid CRECI', async () => {
    const response = await request(app).post('/admin/clients/10/promote-broker').send({ creci: 'X' });
    expect(response.status).toBe(400);
  });

  it('inserts broker row and approves a pure client', async () => {
    loadUserLifecycleSnapshotMock.mockResolvedValue({
      id: 10,
      name: 'Alvo',
      email: 'a@a.com',
      broker_id: null,
      broker_status: null,
    });
    txMock.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1, insertId: 0 } as any]);

    const response = await request(app)
      .post('/admin/clients/10/promote-broker')
      .send({ creci: '12345678' });

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('broker');
    const insertCall = (txMock.query as any).mock.calls.find((c: any[]) =>
      String(c[0]).includes('INSERT INTO brokers'),
    );
    expect(insertCall).toBeTruthy();
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: [10],
        recipientRole: 'broker',
        relatedEntityType: 'broker',
        message: 'Parabens, voce se tornou corretor cadastrado na Encontre Aqui.',
      }),
    );
  });

  it('returns 409 on duplicate CRECI', async () => {
    loadUserLifecycleSnapshotMock.mockResolvedValue({
      id: 10,
      name: 'Alvo',
      email: 'a@a.com',
      broker_id: null,
      broker_status: null,
    });
    txMock.query
      .mockResolvedValueOnce([[{ id: 99 }]])
      .mockResolvedValueOnce([[]]);
    const response = await request(app)
      .post('/admin/clients/10/promote-broker')
      .send({ creci: '12345678' });
    expect(response.status).toBe(409);
  });
});
