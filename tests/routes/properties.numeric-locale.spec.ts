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
    id: 321,
    broker_id: 30003,
    owner_id: null,
    title: 'Apartamento Base',
    description: 'Propriedade utilizada para testes de parser.',
    type: 'Apartamento',
    status: 'approved',
    purpose: 'Venda',
    address: 'Rua da Paz',
    city: 'Cidade',
    state: 'RJ',
    bairro: 'Centro',
    cep: '20000000',
    sem_cep: 0,
    price: 200000,
    price_sale: 200000,
    price_rent: null,
    is_promoted: 0,
    promo_percentage: null,
    promotion_percentage: null,
    valor_condominio: null,
    valor_iptu: null,
    commission_rate: 5,
  };
}

describe('Parser numérico por locale em update de propriedade', () => {
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

  it.each([
    ['1.234,56', 1234.56],
    ['1234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['R$ 1.234,56', 1234.56],
    ['0', 0],
    ['0,00', 0],
  ])('aceita o valor de preço "%s" como %f', async (raw, expected) => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[propertyBase()]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app).patch('/properties/321').send({
      price: raw,
    });

    expect(response.status).toBe(200);
    const updateCall = queryMock.mock.calls.find((call) =>
      String(call[0] ?? '').includes('UPDATE properties SET'),
    );
    expect(updateCall).toBeDefined();
    const updateParams = updateCall?.[1] as unknown[];
    expect(updateParams[0]).toBe(expected);
    expect(updateParams[1]).toBe(321);
  });

  it('aceita valores negativos em campo que permite (commission_rate)', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[propertyBase()]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('SELECT id FROM sales WHERE property_id = ?')) {
        return [[]];
      }
      if (sql.includes('INSERT INTO sales')) {
        return [{ insertId: 777 }];
      }
      if (sql.includes('UPDATE properties SET sale_value')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app).patch('/properties/321').send({
      status: 'vendido',
      amount: '1000',
      commission_rate: '-1,25',
    });

    expect(response.status).toBe(200);
    expect(queryMock.mock.calls.find((call) => String(call[0] ?? '').includes('INSERT INTO sales'))).toBeDefined();
  });
});
