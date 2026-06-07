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
    req.userId = 321;
    req.userRole = 'broker';
    next();
  },
  isBroker: (_req: any, _res: any, next: () => void) => next(),
  isClient: (_req: any, _res: any, next: () => void) => next(),
}));

describe('GET /properties/featured e /properties/me', () => {
  let app: express.Express;

  const featuredRow = {
    id: 9001,
    title: 'Casa Destaque',
    description: 'Imóvel em destaque',
    type: 'Casa',
    purpose: 'Venda',
    status: 'approved',
    visibility: 'PUBLIC',
    lifecycle_status: 'AVAILABLE',
    is_promoted: 1,
    promo_percentage_resolved: 10,
    promo_start_date_resolved: '2026-05-01',
    promo_end_date_resolved: '2026-05-10',
    price: 750000,
    price_sale: 750000,
    price_rent: null,
    promotion_price: null,
    promotional_rent_price: null,
    promotional_rent_percentage: null,
    code: 'RV-9001',
    public_code: 'DESTAQ',
    public_id: '123e4567-e89b-12d3-a456-426614174111',
    owner_name: 'Cliente Destaque',
    owner_phone: '64999990000',
    address: 'Rua Principal',
    cep: '75900000',
    quadra: 'Q1',
    lote: 'L2',
    numero: '123',
    bairro: 'Centro',
    complemento: 'Casa 1',
    sem_cep: 0,
    city: 'Rio Verde',
    state: 'GO',
    bedrooms: 3,
    bathrooms: 2,
    garage_spots: 2,
    has_wifi: 1,
    tem_piscina: 1,
    tem_energia_solar: 0,
    tem_automacao: 1,
    tem_ar_condicionado: 0,
    eh_mobiliada: 1,
    amenities: '["Wi-Fi","Piscina","Automação"]',
    valor_condominio: 0,
    valor_iptu: 900,
    video_url: null,
    images: 'https://cdn/1.jpg,https://cdn/2.jpg',
    agency_id: 10,
    agency_name: 'Agência Top',
    agency_logo_url: 'https://cdn/logo.jpg',
    agency_address: 'Rua da Agência, 10',
    agency_city: 'Rio Verde',
    agency_state: 'GO',
    agency_phone: '6433334444',
    broker_name: 'Corretor Público',
    broker_phone: '64988887777',
    broker_email: 'corretor@example.com',
    active_negotiation_id: null,
    active_negotiation_status: null,
    active_negotiation_value: null,
    active_negotiation_client_name: null,
    created_at: '2026-05-01 10:00:00',
    updated_at: '2026-05-02 10:00:00',
  };

  const userRow = {
    id: 9101,
    title: 'Casa Minha',
    description: 'Imóvel do usuário',
    type: 'Casa',
    purpose: 'Venda',
    status: 'approved',
    visibility: 'PRIVATE',
    lifecycle_status: 'AVAILABLE',
    is_promoted: 0,
    promo_percentage_resolved: null,
    promo_start_date_resolved: null,
    promo_end_date_resolved: null,
    price: 550000,
    price_sale: 550000,
    price_rent: null,
    promotion_price: null,
    promotional_rent_price: null,
    promotional_rent_percentage: null,
    code: 'RV-9101',
    public_code: 'MINHAC',
    public_id: '123e4567-e89b-12d3-a456-426614174222',
    owner_name: 'Meu Cliente',
    owner_phone: '64988880000',
    address: 'Rua do Usuário',
    cep: '75910000',
    quadra: 'Q2',
    lote: 'L3',
    numero: '45',
    bairro: 'Bairro Novo',
    complemento: null,
    sem_cep: 0,
    city: 'Rio Verde',
    state: 'GO',
    bedrooms: 2,
    bathrooms: 1,
    garage_spots: 1,
    has_wifi: 0,
    tem_piscina: 0,
    tem_energia_solar: 0,
    tem_automacao: 0,
    tem_ar_condicionado: 0,
    eh_mobiliada: 0,
    amenities: '[]',
    valor_condominio: 0,
    valor_iptu: 450,
    video_url: null,
    images: 'https://cdn/me.jpg',
    agency_id: null,
    agency_name: null,
    agency_logo_url: null,
    agency_address: null,
    agency_city: null,
    agency_state: null,
    agency_phone: null,
    broker_name: 'Corretor Meu',
    broker_phone: '64977776666',
    broker_email: 'broker@example.com',
    active_negotiation_id: null,
    active_negotiation_status: null,
    active_negotiation_value: null,
    active_negotiation_client_name: null,
    created_at: '2026-05-03 10:00:00',
    updated_at: '2026-05-04 10:00:00',
  };

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();

    queryMock.mockImplementation(async (sql: string) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.includes('FROM featured_properties fp') && normalizedSql.includes('COUNT(*) AS total')) {
        return [[{ total: 1 }], []] as const;
      }

      if (normalizedSql.includes('FROM featured_properties fp')) {
        return [[featuredRow], []] as const;
      }

      if (normalizedSql.includes('WHERE p.owner_id = ? OR p.broker_id = ?')) {
        return [[userRow], []] as const;
      }

      return [[], []] as const;
    });
  });

  it('returns featured properties with pagination metadata', async () => {
    const response = await request(app).get('/properties/featured').query({ scope: 'sale', page: 1, limit: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      total: 1,
      page: 1,
      totalPages: 1,
    });
    expect(response.body.properties).toHaveLength(1);
    expect(response.body.properties[0]).toMatchObject({
      id: 9001,
      title: 'Casa Destaque',
      code: 'RV-9001',
      broker_name: 'Corretor Público',
    });
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it('returns user properties for authenticated requests', async () => {
    const response = await request(app).get('/properties/me');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: 9101,
      title: 'Casa Minha',
      code: 'RV-9101',
      broker_name: 'Corretor Meu',
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
