import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getConnectionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getConnectionMock: vi.fn(),
}));

const dbMock = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 30003;
    req.userRole = 'broker';
    next();
  },
  isBroker: (_req: any, _res: any, next: () => void) => next(),
  isClient: (_req: any, _res: any, next: () => void) => next(),
}));

describe('Property lifecycle routes', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(dbMock);
    dbMock.beginTransaction.mockResolvedValue(undefined);
    dbMock.commit.mockResolvedValue(undefined);
    dbMock.rollback.mockResolvedValue(undefined);
    dbMock.release.mockResolvedValue(undefined);
  });

  it('POST /properties/:id/close closes the deal and persists the sale', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 10,
          broker_id: 30003,
          owner_id: null,
          status: 'approved',
          purpose: 'Venda',
          price_sale: 500000,
          price_rent: null,
          price: 500000,
          commission_rate: 5,
          valor_iptu: 100,
          valor_condominio: 200,
        },
      ],
      [],
    ]);

    dbMock.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    dbMock.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    dbMock.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .post('/properties/10/close')
      .send({
        type: 'sale',
        amount: '500000',
        commission_rate: '6',
        commission_cycles: '2',
        recurrence_interval: 'monthly',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: 'Negócio fechado com sucesso.',
      status: 'sold',
    });
    expect(dbMock.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbMock.commit).toHaveBeenCalledTimes(1);
  });

  it('POST /properties/:id/cancel-deal cancels the deal and restores availability', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 11,
          broker_id: 30003,
          owner_id: null,
          status: 'sold',
        },
      ],
      [],
    ]);

    dbMock.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
    dbMock.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).post('/properties/11/cancel-deal');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: 'Negocio cancelado com sucesso.',
      status: 'approved',
    });
    expect(dbMock.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbMock.commit).toHaveBeenCalledTimes(1);
  });
});
