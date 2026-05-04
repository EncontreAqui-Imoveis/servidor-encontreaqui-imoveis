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

describe('GET /public/properties/:id', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: publicRoutes } = await import('../../src/routes/public.routes');
    app = express();
    app.use(express.json());
    app.use(publicRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies approved/public filters and returns 404 when the property is not publicly visible', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app).get('/public/properties/30102');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Imóvel não encontrado.' });

    const executedSql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(executedSql).toContain("p.status = 'approved'");
    expect(executedSql).toContain("COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'");
  });

  it('loads public property by public_code', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 30102,
          title: 'Casa Centro',
          description: 'Casa completa',
          type: 'Casa',
          purpose: 'Venda',
          status: 'approved',
          visibility: 'PUBLIC',
          lifecycle_status: 'AVAILABLE',
          is_promoted: 0,
          promo_percentage: null,
          promo_start_date: null,
          promo_end_date: null,
          promotion_percentage: null,
          promotion_start: null,
          promotion_end: null,
          price: 350000,
          price_sale: 350000,
          price_rent: null,
          promotion_price: null,
          promotional_rent_price: null,
          promotional_rent_percentage: null,
          code: 'RV-30102',
          public_id: '123e4567-e89b-12d3-a456-426614174000',
          public_code: '2AB3CD',
          area_construida_valor: 120,
          area_construida_unidade: 'm2',
          area_construida_m2: 120,
          area_terreno_valor: 250,
          area_terreno_unidade: 'm2',
          area_terreno_m2: 250,
          owner_name: null,
          owner_phone: null,
          address: 'Rua Principal',
          cep: '75935000',
          quadra: 'Q1',
          lote: 'L2',
          numero: '123',
          bairro: 'Centro',
          complemento: 'Casa 1',
          sem_cep: 0,
          city: 'Brasil',
          state: 'GO',
          bedrooms: 3,
          bathrooms: 2,
          area_construida: 120,
          area_terreno: 250,
          garage_spots: 2,
          has_wifi: 1,
          tem_piscina: 1,
          tem_energia_solar: 0,
          tem_automacao: 1,
          tem_ar_condicionado: 0,
          eh_mobiliada: 1,
          valor_condominio: 0,
          valor_iptu: 900,
          video_url: 'https://cdn/video.mp4',
          images: 'https://cdn/1.jpg,https://cdn/2.jpg',
          agency_id: 1,
          agency_name: 'Encontre Aqui',
          agency_logo_url: 'https://cdn/logo.jpg',
          agency_address: 'Rua da Agência, 10',
          agency_city: 'Brasil',
          agency_state: 'GO',
          agency_phone: '6433334444',
          broker_name: 'Corretor Público',
          broker_phone: '64988887777',
          broker_email: 'corretor@test.com',
          active_negotiation_id: null,
          active_negotiation_status: null,
          active_negotiation_value: null,
          active_negotiation_client_name: null,
          created_at: '2026-03-01 10:00:00',
          updated_at: '2026-03-02 08:00:00',
        },
      ],
    ]);

    const response = await request(app).get('/public/properties/2AB3CD');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 30102,
      public_code: '2AB3CD',
      area_construida_valor: 120,
      area_construida_unidade: 'm2',
      area_construida_m2: 120,
      area_terreno_valor: 250,
      area_terreno_unidade: 'm2',
      area_terreno_m2: 250,
      public_id: '123e4567-e89b-12d3-a456-426614174000',
      status: 'approved',
      purpose: 'Venda',
      images: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
    });
  });

  it('loads public property by slug ending with public_code', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 30103,
          title: 'Apartamento Centro',
          description: 'Apto completo',
          type: 'Apartamento',
          purpose: 'Aluguel',
          status: 'approved',
          visibility: 'PUBLIC',
          lifecycle_status: 'AVAILABLE',
          is_promoted: 0,
          promo_percentage: null,
          promo_start_date: null,
          promo_end_date: null,
          promotion_percentage: null,
          promotion_start: null,
          promotion_end: null,
          price: 1800,
          price_sale: null,
          price_rent: 1800,
          promotion_price: null,
          promotional_rent_price: null,
          promotional_rent_percentage: null,
          code: 'AP-30103',
          public_id: '123e4567-e89b-12d3-a456-426614174001',
          public_code: '34FGHJ',
          owner_name: null,
          owner_phone: null,
          address: 'Rua do Centro',
          cep: '75936000',
          quadra: 'Q2',
          lote: 'L4',
          numero: '456',
          bairro: 'Centro',
          complemento: 'Apto 201',
          sem_cep: 0,
          city: 'Brasil',
          state: 'GO',
          bedrooms: 2,
          bathrooms: 1,
          area_construida: 70,
          area_terreno: 70,
          garage_spots: 1,
          has_wifi: 0,
          tem_piscina: 0,
          tem_energia_solar: 0,
          tem_automacao: 0,
          tem_ar_condicionado: 1,
          eh_mobiliada: 1,
          valor_condominio: 250,
          valor_iptu: 50,
          video_url: null,
          images: 'https://cdn/slug-1.jpg',
          agency_id: 1,
          agency_name: 'Encontre Aqui',
          agency_logo_url: 'https://cdn/logo.jpg',
          agency_address: 'Rua da Agência, 10',
          agency_city: 'Brasil',
          agency_state: 'GO',
          agency_phone: '6433334444',
          broker_name: 'Corretor Público',
          broker_phone: '64988887777',
          broker_email: 'corretor@test.com',
          active_negotiation_id: null,
          active_negotiation_status: null,
          active_negotiation_value: null,
          active_negotiation_client_name: null,
          created_at: '2026-03-03 10:00:00',
          updated_at: '2026-03-04 08:00:00',
        },
      ],
    ]);

    const response = await request(app).get('/public/properties/imovel-para-alugar-34FGHJ');

    expect(response.status).toBe(200);
    expect(response.body.public_code).toBe('34FGHJ');
  });
});
