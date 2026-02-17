import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
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

vi.mock('../../src/middlewares/uploadMiddleware', () => ({
  mediaUpload: {
    fields: () => (_req: any, _res: any, next: () => void) => next(),
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

describe('PATCH /properties/:id promo fields', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists promo_percentage with promo_start_date and promo_end_date', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 101,
          broker_id: 30003,
          owner_id: null,
          title: 'Casa Teste',
          status: 'approved',
          purpose: 'Venda',
          price: 500000,
          price_sale: 500000,
          price_rent: null,
          is_promoted: 1,
          promo_percentage: null,
          promotion_percentage: null,
          valor_condominio: null,
          valor_iptu: null,
          commission_rate: null,
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).patch('/properties/101').send({
      promo_percentage: 10,
      promo_start_date: '2026-02-20',
      promo_end_date: '2026-02-28',
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('atualizado');

    const updateSql = String(queryMock.mock.calls[1]?.[0] ?? '');
    const updateParams = queryMock.mock.calls[1]?.[1] as unknown[];

    expect(updateSql).toContain('promo_percentage = ?');
    expect(updateSql).toContain('promo_start_date = ?');
    expect(updateSql).toContain('promo_end_date = ?');
    expect(updateParams).toEqual(
      expect.arrayContaining([
        10,
        10,
        '2026-02-20',
        '2026-02-20 00:00:00',
        '2026-02-28',
        '2026-02-28 00:00:00',
        101,
      ])
    );
  });
});
