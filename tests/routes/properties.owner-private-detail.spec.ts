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
    req.userId = 123;
    req.userRole = 'client';
    next();
  },
  isBroker: (_req: any, _res: any, next: () => void) => next(),
  isClient: (_req: any, _res: any, next: () => void) => next(),
}));

describe('GET /properties/:id privado', () => {
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

  const pendingApprovalProperty = {
    id: 90100,
    status: 'pending_approval',
    visibility: 'PRIVATE',
    title: 'Casa com pendencia',
    description: 'Imovel em analise para teste',
    type: 'Casa',
    purpose: 'Venda',
    price: 100000,
    price_sale: 100000,
    price_rent: null,
    promotion_price: null,
    promotional_rent_price: null,
    promotional_rent_percentage: null,
    promo_percentage: null,
    promo_start_date: null,
    promo_end_date: null,
    promotion_percentage: null,
    promotion_start: null,
    promotion_end: null,
    lifecycle_status: 'AVAILABLE',
    is_promoted: 0,
    code: 'PRV001',
    owner_id: 123,
    broker_id: null,
    owner_name: 'Dono teste',
    owner_phone: '(64) 99999-0000',
    address: 'Rua Teste',
    cep: '75900000',
    sem_cep: 0,
    bairro: 'Centro',
    numero: '123',
    cidade: 'Cidade',
    city: 'Cidade',
    state: 'GO',
    quadra: 'Q1',
    lote: 'L1',
    complemento: null,
    sem_quadra: 0,
    sem_lote: 0,
    sem_numero: 0,
    bedrooms: 3,
    bathrooms: 1,
    garage_spots: 1,
    has_wifi: 1,
    tem_piscina: 0,
    tem_energia_solar: 0,
    tem_automacao: 0,
    tem_ar_condicionado: 0,
    eh_mobiliada: 0,
    valor_condominio: 0,
    valor_iptu: 100,
    video_url: null,
    images: 'https://cdn/image1.jpg',
    area: 120,
    area_construida_valor: 120,
    area_construida_unidade: 'm2',
    area_construida_m2: 120,
    area_terreno_valor: 300,
    area_terreno_unidade: 'm2',
    area_terreno_m2: 300,
    amenities: '[]',
    active_negotiation_id: null,
    active_negotiation_status: null,
    active_negotiation_value: null,
    active_negotiation_client_name: null,
    broker_name: null,
    broker_phone: null,
    broker_email: null,
    pending_edit_request_id: null,
    created_at: '2026-01-01 10:00:00',
    updated_at: '2026-01-02 12:00:00',
  };

  it('permite dono visualizar imóvel em analise em endpoint privado autenticado', async () => {
    queryMock.mockResolvedValueOnce([[pendingApprovalProperty]]);

    const response = await request(app).get('/properties/90100');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(90100);
    expect(response.body.status).toBe('pending_approval');
    expect(response.body.owner_id).toBe(123);
  });

  it('mantem 404 para imóvel em analise quando não é o dono', async () => {
    queryMock.mockResolvedValueOnce([[{ ...pendingApprovalProperty, owner_id: 999 }]]);

    const response = await request(app).get('/properties/90100');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Imóvel não encontrado.' });
  });
});

