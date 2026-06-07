import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getConnectionMock, notifyAdminsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getConnectionMock: vi.fn(),
  notifyAdminsMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    getConnection: getConnectionMock,
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

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
  createAdminNotification: vi.fn(),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

const baseProperty = {
  id: 101,
  broker_id: 30003,
  owner_id: null,
  title: 'Casa Teste',
  description: 'Descrição válida do imóvel com tamanho adequado para validação.',
  type: 'Casa',
  status: 'approved',
  purpose: 'Venda',
  address: 'Rua A',
  city: 'Rio Verde',
  state: 'GO',
  bairro: 'Centro',
  price: 500000,
  price_sale: 500000,
  price_rent: null,
  is_promoted: 0,
  promo_percentage: null,
  promotion_percentage: null,
  promotion_price: null,
  promotional_rent_price: null,
  promotional_rent_percentage: null,
  valor_condominio: null,
  valor_iptu: null,
  code: 'IMOVEL-001',
  owner_name: 'Maria',
  owner_phone: '64999999999',
  complemento: null,
  cep: '75900000',
  sem_cep: 0,
  bedrooms: 3,
  bathrooms: 2,
  area_construida: 180,
  area_construida_unidade: 'm2',
  area_construida_valor: 180,
  area_construida_m2: 180,
  area_terreno: 250,
  area_terreno_unidade: 'm2',
  area_terreno_valor: 250,
  area_terreno_m2: 250,
  garage_spots: 2,
  has_wifi: 1,
  tem_piscina: 0,
  tem_energia_solar: 0,
  tem_automacao: 0,
  tem_ar_condicionado: 1,
  eh_mobiliada: 0,
};

function createDbMock() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
    query: queryMock,
  };
}

describe('POST /properties/:id/edit-requests', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(createDbMock());
    notifyAdminsMock.mockResolvedValue(undefined);
  });

  it('cria solicitação de edição para corretor com diff válido', async () => {
    queryMock
      .mockResolvedValueOnce([[baseProperty]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 99, affectedRows: 1 }]);

    const response = await request(app).post('/properties/101/edit-requests').send({
      title: 'Casa atualizada',
    });

    expect(response.status).toBe(202);
    expect(response.body.requestId).toBe(99);
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);

    const insertCall = queryMock.mock.calls[2];
    expect(String(insertCall?.[0] ?? '')).toContain('INSERT INTO property_edit_requests');
    expect(insertCall?.[1]).toEqual(
      expect.arrayContaining([
        101,
        30003,
        'broker',
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ])
    );
  });

  it('retorna 409 quando já existe solicitação pendente', async () => {
    queryMock
      .mockResolvedValueOnce([[baseProperty]])
      .mockResolvedValueOnce([[{ id: 1, status: 'PENDING' }]]);

    const response = await request(app).post('/properties/101/edit-requests').send({
      title: 'Casa atualizada',
    });

    expect(response.status).toBe(409);
    expect(queryMock.mock.calls.length).toBe(2);
  });

  it('retorna 400 quando não há alteração válida', async () => {
    queryMock
      .mockResolvedValueOnce([[baseProperty]])
      .mockResolvedValueOnce([[]]);

    const response = await request(app).post('/properties/101/edit-requests').send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PROPERTY_NO_UPDATE_DATA');
    expect(queryMock.mock.calls.length).toBe(2);
  });
});
