import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  return { queryMock: vi.fn() };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: vi.fn(),
    query: queryMock,
    execute: vi.fn(),
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(null),
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

describe('GET /admin/properties-with-brokers código numérico', () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).userId = 1;
    (req as any).userRole = 'admin';
    next();
  });
  app.get('/admin/properties-with-brokers', (req, res) =>
    adminController.listPropertiesWithBrokers(req, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([[]]);
  });

  it('inclui igualdade numérica no código quando o termo é só dígitos', async () => {
    await request(app).get('/admin/properties-with-brokers').query({ search: '0000007', page: 1, limit: 10 });

    const countCall = queryMock.mock.calls[0];
    const [sql, params] = countCall as [string, unknown[]];
    expect(String(sql)).toContain('CAST(p.code AS UNSIGNED)');
    expect(String(sql)).toContain('REGEXP');
    expect(params).toContain(7);
  });
});
