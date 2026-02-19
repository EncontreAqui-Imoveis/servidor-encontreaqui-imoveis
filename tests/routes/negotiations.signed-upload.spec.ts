import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  txMock,
  getConnectionMock,
  queryMock,
  createAdminNotificationMock,
} = vi.hoisted(() => {
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
    createAdminNotificationMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    execute: vi.fn(),
    query: queryMock,
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 30003;
    req.userRole = 'broker';
    next();
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
  notifyAdmins: vi.fn(),
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('POST /negotiations/:id/proposals/signed', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.execute.mockResolvedValue({ insertId: 70001 });
    createAdminNotificationMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValue([]);
  });

  it('stores signed PDF, moves negotiation to review and notifies admins', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 'neg-uuid-1',
          property_id: 101,
          status: 'PROPOSAL_SENT',
          capturing_broker_id: 30003,
          selling_broker_id: 30003,
          property_code: 'RV101',
          property_address: 'Rua 1',
          broker_name: 'Pedro Corretor',
        },
      ],
    ]);

    const response = await request(app)
      .post('/negotiations/neg-uuid-1/proposals/signed')
      .attach('file', Buffer.from('%PDF-1.4 signed%'), 'proposta_assinada.pdf');

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('UNDER_REVIEW');
    expect(txMock.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO negotiation_documents'),
      expect.arrayContaining(['neg-uuid-1', expect.any(Buffer)])
    );
    expect(txMock.execute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE negotiations'),
      ['DOCUMENTATION_PHASE', 'neg-uuid-1']
    );
    expect(createAdminNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'negotiation',
        relatedEntityId: 101,
        metadata: expect.objectContaining({
          negotiationId: 'neg-uuid-1',
          propertyId: 101,
        }),
      })
    );
  });
});
