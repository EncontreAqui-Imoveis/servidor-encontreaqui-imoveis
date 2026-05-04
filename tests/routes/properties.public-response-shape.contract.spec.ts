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

describe('Public property response shape contracts', () => {
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

  it('returns the list shape consumed by the public site catalog', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM properties p') && sql.includes('GROUP BY p.id')) {
        return [[
          {
            id: 30102,
            title: 'Casa Centro',
            description: 'Casa completa',
            type: 'Casa',
            purpose: 'Venda e Aluguel',
            status: 'approved',
            visibility: 'PUBLIC',
            lifecycle_status: 'AVAILABLE',
            is_promoted: 1,
            promo_percentage_resolved: 10,
            promo_start_date_resolved: '2026-02-18',
            promo_end_date_resolved: '2026-02-27',
            price: 2.32,
            price_sale: 2.32,
            price_rent: 2323.32,
            promotion_price: null,
            promotional_rent_price: null,
            promotional_rent_percentage: null,
            code: 'RV-30102',
            public_code: '2AB3CD',
            public_id: '123e4567-e89b-12d3-a456-426614174000',
            owner_name: 'Cliente',
            owner_phone: '64999999999',
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
        area_construida_valor: 120,
        area_construida_unidade: 'm2',
        area_construida_m2: 120,
        area_terreno_valor: 250,
        area_terreno_unidade: 'm2',
        area_terreno_m2: 250,
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
            active_negotiation_id: 'neg-1',
            active_negotiation_status: 'IN_NEGOTIATION',
            active_negotiation_value: 350000,
            active_negotiation_client_name: 'Comprador',
            created_at: '2026-03-01 10:00:00',
            updated_at: '2026-03-02 08:00:00',
          },
        ]];
      }

      if (sql.includes('COUNT(DISTINCT p.id) AS total')) {
        return [[{ total: 1 }]];
      }

      return [[]];
    });

    const response = await request(app).get('/properties?status=approved&limit=1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      properties: [
        {
          id: 30102,
          title: 'Casa Centro',
          type: 'Casa',
          status: 'approved',
          purpose: 'Venda e Aluguel',
          code: 'RV-30102',
          public_code: '2AB3CD',
        area_construida_valor: 120,
        area_construida_unidade: 'm2',
        area_construida_m2: 120,
        area_terreno_valor: 250,
        area_terreno_unidade: 'm2',
        area_terreno_m2: 250,
          city: 'Brasil',
          state: 'GO',
          broker_name: 'Corretor Público',
          broker_phone: '64988887777',
          images: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
    });
  });

  it('returns the detail shape consumed by the public site details page', async () => {
    queryMock.mockResolvedValueOnce([[
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
        promo_percentage_resolved: null,
        promo_start_date_resolved: null,
        promo_end_date_resolved: null,
        price: 350000,
        price_sale: 350000,
        price_rent: null,
        promotion_price: null,
        promotional_rent_price: null,
        promotional_rent_percentage: null,
        code: 'RV-30102',
        public_code: '2AB3CD',
        public_id: '123e4567-e89b-12d3-a456-426614174000',
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
        area_construida_valor: 120,
        area_construida_unidade: 'm2',
        area_construida_m2: 120,
        area_terreno_valor: 250,
        area_terreno_unidade: 'm2',
        area_terreno_m2: 250,
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
        active_negotiation_id: 'neg-1',
        active_negotiation_status: 'IN_NEGOTIATION',
        active_negotiation_value: 350000,
        active_negotiation_client_name: 'Comprador',
        created_at: '2026-03-01 10:00:00',
        updated_at: '2026-03-02 08:00:00',
      },
    ]]);

    const response = await request(app).get('/public/properties/30102');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 30102,
      title: 'Casa Centro',
      status: 'approved',
      purpose: 'Venda',
      code: 'RV-30102',
      public_code: '2AB3CD',
        area_construida_valor: 120,
        area_construida_unidade: 'm2',
        area_construida_m2: 120,
        area_terreno_valor: 250,
        area_terreno_unidade: 'm2',
        area_terreno_m2: 250,
      public_id: '123e4567-e89b-12d3-a456-426614174000',
      broker_name: 'Corretor Público',
      broker_phone: '64988887777',
      images: ['https://cdn/1.jpg', 'https://cdn/2.jpg'],
      agency: {
        name: 'Encontre Aqui',
        address: 'Rua da Agência, 10',
      },
    });
  });
});
