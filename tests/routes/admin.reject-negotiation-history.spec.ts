import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, queryMock, createUserNotificationMock } =
  vi.hoisted(() => {
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
      createUserNotificationMock: vi.fn(),
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

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: createUserNotificationMock,
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

describe('PUT /admin/negotiations/:id/reject negotiation_history', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 42;
    (req as any).userRole = 'admin';
    next();
  });
  app.put('/admin/negotiations/:id/reject', (req, res) =>
    adminController.rejectNegotiation(req as any, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    createUserNotificationMock.mockResolvedValue(undefined);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM negotiations n') && sql.includes('FOR UPDATE')) {
        return [
          [
            {
              id: 'neg-rej-1',
              status: 'PROPOSAL_SENT',
              property_id: 101,
              capturing_broker_id: 30003,
              buyer_client_id: null,
              property_title: 'Casa Centro',
              property_code: 'RV-101',
              property_address: 'Rua 1',
              property_status: 'approved',
              lifecycle_status: 'AVAILABLE',
            },
          ],
        ];
      }

      if (sql.includes('SELECT COUNT(*) AS cnt') && sql.includes('FROM negotiations')) {
        return [[{ cnt: 1 }]];
      }

      if (sql.includes('DELETE FROM negotiation_proposal_idempotency')) {
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE negotiations') && sql.includes('REFUSED')) {
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('INSERT INTO negotiation_history')) {
        return [{ affectedRows: 1 }];
      }

      if (
        sql.includes('UPDATE properties') &&
        sql.includes("SET status = 'approved'") &&
        sql.includes('visibility')
      ) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });
  });

  it('inserts negotiation_history with NULL actor_id and adminId in metadata (admin JWT is not users.id)', async () => {
    const response = await request(app)
      .put('/admin/negotiations/neg-rej-1/reject')
      .send({ reason: 'Documentação incompleta para seguir.' });

    expect(response.status).toBe(200);

    const historyCalls = txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO negotiation_history')
    );
    expect(historyCalls.length).toBeGreaterThanOrEqual(1);
    const [, params] = historyCalls[0] as [string, unknown[]];
    const sql = String(historyCalls[0][0]);
    expect(sql).toContain('REFUSED');
    expect(sql).toContain('NULL');
    expect(params).toHaveLength(3);
    expect(params[0]).toBe('neg-rej-1');
    expect(params[1]).toBe('PROPOSAL_SENT');
    const meta = JSON.parse(String(params[2]));
    expect(meta.action).toBe('admin_rejected');
    expect(meta.adminId).toBe(42);
    expect(meta.reason).toBe('Documentação incompleta para seguir.');
  });
});
