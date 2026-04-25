import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnectionMock, txMock, notifyAdminsMock, notifyUsersMock } = vi.hoisted(() => {
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
    notifyAdminsMock: vi.fn(),
    notifyUsersMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: vi.fn(),
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
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  resolveUserNotificationRole: vi.fn().mockResolvedValue('broker'),
  splitRecipientsByRole: vi.fn().mockResolvedValue({ clientIds: [], brokerIds: [] }),
}));

import { adminController } from '../../src/controllers/AdminController';

describe('PATCH /admin/brokers/:id/status lifecycle', () => {
  const app = express();
  app.use(express.json());
  app.patch('/admin/brokers/:id/status', (req, res) =>
    adminController.updateBrokerStatus(req as any, res),
  );
  app.post('/admin/clients/:id/demote-broker', (req, res) =>
    adminController.demoteClientBroker(req as any, res),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
  });

  it('rejects a broker by downgrading to client and revoking sessions', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 77,
            name: 'Broker Teste',
            email: 'broker@test.com',
            broker_id: 77,
            broker_status: 'approved',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 77,
            name: 'Broker Teste',
            email: 'broker@test.com',
            broker_id: 77,
            broker_status: 'approved',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .patch('/admin/brokers/77/status')
      .send({ status: 'rejected' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'rejected',
      role: 'client',
    });
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE brokers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['rejected', 77],
    );
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE broker_documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE broker_id = ?',
      ['rejected', 77],
    );
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE properties SET broker_id = NULL WHERE broker_id = ?',
      [77],
    );
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [77],
    );
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: [77],
        recipientRole: 'client',
        message: 'Sua solicitacao para se tornar corretor foi rejeitada. Sua conta voltou para cliente.',
      }),
    );
  });

  it('updates broker partially without nulling name and email', async () => {
    const updateApp = express();
    updateApp.use(express.json());
    updateApp.put('/admin/brokers/:id', (req, res) =>
      adminController.updateBroker(req as any, res),
    );

    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 77,
            name: 'Broker Teste',
            email: 'broker@test.com',
            broker_id: 77,
            broker_status: 'approved',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [
          {
            id: 77,
            name: 'Broker Teste',
            email: 'broker@test.com',
            broker_id: 77,
            broker_status: 'approved',
          },
        ],
      ]);

    const response = await request(updateApp)
      .put('/admin/brokers/77')
      .send({ phone: '64999999999' });

    expect(response.status).toBe(200);
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE users SET phone = ? WHERE id = ?',
      ['64999999999', 77],
    );
    expect(
      txMock.query.mock.calls.some((call) =>
        String(call[0]).includes('name = ?') || String(call[0]).includes('email = ?'),
      ),
    ).toBe(false);
  });

  it('demotes broker via client endpoint keeping role client', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 88,
            name: 'Broker Demote',
            email: 'broker2@test.com',
            broker_id: 88,
            broker_status: 'approved',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).post('/admin/clients/88/demote-broker').send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      role: 'client',
      status: 'rejected',
    });
  });
});
