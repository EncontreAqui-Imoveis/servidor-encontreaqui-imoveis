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

type ContractState = {
  id: string;
  negotiationId: string;
  propertyId: number;
  status: string;
  sellerApprovalStatus: string;
  buyerApprovalStatus: string;
} | null;

describe('PUT /admin/negotiations/:id/approve contract auto-creation', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 1;
    (req as any).userRole = 'admin';
    next();
  });
  app.put('/admin/negotiations/:id/approve', (req, res) =>
    adminController.approveNegotiation(req as any, res)
  );

  let negotiationStatus: string;
  let contractState: ContractState;
  let contractInsertCount: number;

  beforeEach(() => {
    vi.clearAllMocks();

    negotiationStatus = 'DOCUMENTATION_PHASE';
    contractState = null;
    contractInsertCount = 0;

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    createUserNotificationMock.mockResolvedValue(undefined);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM negotiations n') && sql.includes('FOR UPDATE')) {
        return [[
          {
            id: 'neg-1',
            status: negotiationStatus,
            property_id: 101,
            capturing_broker_id: 30003,
            property_title: 'Casa Centro',
            property_code: 'RV-101',
            property_address: 'Rua 1, Centro',
            property_status: 'approved',
            lifecycle_status: 'AVAILABLE',
          },
        ]];
      }

      if (sql.includes('UPDATE negotiations') && sql.includes("SET status = 'IN_NEGOTIATION'")) {
        negotiationStatus = 'IN_NEGOTIATION';
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('INSERT INTO negotiation_history')) {
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE properties') && sql.includes("SET status = 'negociacao'")) {
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('FROM contracts') && sql.includes('FOR UPDATE')) {
        return [contractState ? [{ id: contractState.id }] : []];
      }

      if (sql.includes('INSERT INTO contracts')) {
        contractInsertCount += 1;
        contractState = {
          id: `contract-${contractInsertCount}`,
          negotiationId: String(params[0]),
          propertyId: Number(params[1]),
          status: 'AWAITING_DOCS',
          sellerApprovalStatus: 'PENDING',
          buyerApprovalStatus: 'PENDING',
        };
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });
  });

  it('creates a contract in AWAITING_DOCS when approving a negotiation', async () => {
    const response = await request(app).put('/admin/negotiations/neg-1/approve');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('APPROVED');
    expect(contractState).not.toBeNull();
    expect(contractState?.negotiationId).toBe('neg-1');
    expect(contractState?.propertyId).toBe(101);
    expect(contractState?.status).toBe('AWAITING_DOCS');
    expect(contractState?.sellerApprovalStatus).toBe('PENDING');
    expect(contractState?.buyerApprovalStatus).toBe('PENDING');
    expect(contractInsertCount).toBe(1);
    const propertyMoveCalls = txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE properties") &&
      String(sql).includes("SET status = 'negociacao'")
    );
    expect(propertyMoveCalls).toHaveLength(1);
  });

  it('is idempotent and keeps only one contract when approve is called twice', async () => {
    const first = await request(app).put('/admin/negotiations/neg-1/approve');
    const second = await request(app).put('/admin/negotiations/neg-1/approve');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(contractInsertCount).toBe(1);
    expect(contractState?.negotiationId).toBe('neg-1');
  });
});
