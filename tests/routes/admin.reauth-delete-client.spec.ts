import bcrypt from 'bcryptjs';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getConnectionMock, txMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    queryMock: vi.fn(),
    getConnectionMock: vi.fn(),
    txMock: tx,
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  __esModule: true,
  default: {},
  uploadToCloudinary: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: vi.fn().mockResolvedValue(null),
  resolveUserNotificationRole: vi.fn().mockResolvedValue('client'),
  splitRecipientsByRole: vi.fn().mockResolvedValue({ clientIds: [], brokerIds: [] }),
}));

import { adminController } from '../../src/controllers/AdminController';
import { requireAdminReauth } from '../../src/middlewares/adminReauth';

describe('POST /admin/reauth and DELETE /admin/clients/:id', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 99;
    (req as any).userRole = 'admin';
    (req as any).adminValidated = true;
    next();
  });
  app.post('/admin/reauth', (req, res) => adminController.reauth(req as any, res));
  app.delete(
    '/admin/clients/:id',
    (req, res, next) => requireAdminReauth(req as any, res, next),
    (req, res) => adminController.deleteClient(req as any, res),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
  });

  it('requires reauthentication before deleting a client', async () => {
    const response = await request(app).delete('/admin/clients/123');

    expect(response.status).toBe(401);
    expect(String(response.body.error ?? '')).toContain('Reautenticacao');
  });

  it('issues a reauth token and accepts it on destructive delete', async () => {
    const passwordHash = await bcrypt.hash('secret-123', 8);

    queryMock.mockResolvedValueOnce([
      [{ id: 99, password_hash: passwordHash, token_version: 7 }],
    ]);

    const reauthResponse = await request(app)
      .post('/admin/reauth')
      .send({ password: 'secret-123' });

    expect(reauthResponse.status).toBe(200);
    expect(reauthResponse.body.reauthToken).toEqual(expect.any(String));

    queryMock.mockResolvedValueOnce([
      [{ token_version: 7 }],
    ]);

    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 123,
            name: 'Cliente Teste',
            email: 'cliente@test.com',
            broker_id: null,
            broker_status: null,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 123,
            name: 'Cliente Teste',
            email: 'cliente@test.com',
            broker_id: null,
            broker_status: null,
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const deleteResponse = await request(app)
      .delete('/admin/clients/123')
      .set('x-admin-reauth', reauthResponse.body.reauthToken);

    expect(deleteResponse.status).toBe(200);
    expect(String(deleteResponse.body.message ?? '')).toContain('Cliente deletado');
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM notifications'),
      [123],
    );
    expect(txMock.query).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?', [123]);
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });
});
