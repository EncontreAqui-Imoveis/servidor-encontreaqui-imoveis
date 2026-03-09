import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, queryMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    txMock: tx,
    getConnectionMock: vi.fn(),
    queryMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    query: queryMock,
    execute: vi.fn(),
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
  sendPushNotifications: vi.fn().mockResolvedValue({
    requested: 0,
    success: 0,
    failure: 0,
    errorCodes: [],
  }),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn().mockResolvedValue(undefined),
  notifyPromotionStarted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: vi.fn().mockResolvedValue(null),
  resolveUserNotificationRole: vi.fn().mockReturnValue('client'),
  splitRecipientsByRole: vi.fn().mockReturnValue({
    clients: [],
    brokers: [],
    admins: [],
  }),
}));

import { adminController } from '../../src/controllers/AdminController';

describe('DELETE /admin/users/:id', () => {
  const app = express();
  app.delete('/admin/users/:id', (req, res) => adminController.deleteUser(req, res));

  beforeEach(() => {
    vi.clearAllMocks();

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
  });

  it('nulls actor_id in negotiation_history before deleting the user', async () => {
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE negotiation_history SET actor_id = NULL')) {
        return [{ affectedRows: 2 }];
      }

      if (sql.includes('DELETE FROM users')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });

    const response = await request(app).delete('/admin/users/150002');

    expect(response.status).toBe(200);
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE negotiation_history SET actor_id = NULL WHERE actor_id = ?',
      [150002]
    );
    expect(txMock.query).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?', [150002]);
    expect(txMock.commit).toHaveBeenCalled();
  });

  it('falls back to deleting negotiation_history rows if actor_id cannot be nulled', async () => {
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE negotiation_history SET actor_id = NULL')) {
        throw new Error('ER_BAD_NULL_ERROR');
      }

      if (sql.includes('DELETE FROM negotiation_history WHERE actor_id = ?')) {
        return [{ affectedRows: 2 }];
      }

      if (sql.includes('DELETE FROM users')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });

    const response = await request(app).delete('/admin/users/150002');

    expect(response.status).toBe(200);
    expect(txMock.query).toHaveBeenCalledWith(
      'DELETE FROM negotiation_history WHERE actor_id = ?',
      [150002]
    );
    expect(txMock.query).toHaveBeenCalledWith('DELETE FROM users WHERE id = ?', [150002]);
    expect(txMock.commit).toHaveBeenCalled();
  });

  it('returns 400 for an invalid user id', async () => {
    const response = await request(app).delete('/admin/users/abc');

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('Identificador');
  });
});
