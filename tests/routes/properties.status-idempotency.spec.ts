import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, notifyAdminsMock, createAdminNotificationMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notifyAdminsMock: vi.fn(),
  createAdminNotificationMock: vi.fn(),
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

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
  createAdminNotification: createAdminNotificationMock,
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

function propertyBase() {
  return {
    id: 555,
    broker_id: 30003,
    owner_id: null,
    title: 'Casa Teste',
    description: 'Casa com área e preços válidos.',
    type: 'Casa',
    status: 'approved',
    purpose: 'Venda',
    address: 'Rua A',
    city: 'Cidade',
    state: 'SP',
    bairro: 'Centro',
    cep: '10000000',
    sem_cep: 0,
    price: 100000,
    price_sale: 100000,
    price_rent: null,
    is_promoted: 0,
    promo_percentage: null,
    promotion_percentage: null,
    valor_condominio: null,
    valor_iptu: null,
    commission_rate: 5,
  };
}

describe('PATCH /properties/:id - idempotencia de status', () => {
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

  it('notifica apenas na primeira transição validada para vendido', async () => {
    let calls = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        calls += 1;
        return [[{ ...propertyBase(), status: calls === 1 ? 'approved' : 'sold' }]];
      }

      if (sql.includes('SELECT id FROM sales WHERE property_id = ?')) {
        return [[]];
      }

      if (sql.includes('INSERT INTO sales')) {
        return [{ insertId: 111 }];
      }

      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });

    const first = await request(app).patch('/properties/555').send({
      status: 'vendido',
      amount: '100000',
    });

    const second = await request(app).patch('/properties/555').send({
      status: 'vendido',
      amount: '100000',
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(notifyAdminsMock).toHaveBeenCalledWith(
      'O imóvel \'Casa Teste\' foi marcado como vendido.',
      'property',
      555,
    );
  });
});
