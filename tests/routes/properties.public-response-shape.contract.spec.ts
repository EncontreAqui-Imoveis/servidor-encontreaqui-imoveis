import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanonicalAmenity } from '../../src/utils/propertyAmenities';

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
            amenities: '["Wi-Fi","MOBILIADA","SISTEMA DE SEGURANÇA/CÂMERA","Wi-Fi"]',
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

    const firstProperty = response.body.properties?.[0];
    const normalizedAmenities = Array.isArray(firstProperty?.amenities)
      ? firstProperty.amenities
          .map((amenity: string) => toCanonicalAmenity(amenity))
          .filter((amenity: unknown): amenity is string => typeof amenity === 'string')
      : [];
    expect(normalizedAmenities).toEqual(
      expect.arrayContaining([
        'Wi-Fi',
        'Piscina',
        'Automação',
        'Mobiliada',
        'SISTEMA DE SEGURANÇA/CÂMERA',
      ]),
    );
    expect(normalizedAmenities).toHaveLength(5);
  });

  it('returns original area units and derived m² in public listing payload', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM properties p') && sql.includes('GROUP BY p.id')) {
        return [[
          {
            id: 50102,
            title: 'Sítio Horizonte',
            description: 'Terreno para investimento',
            type: 'Sítio',
            purpose: 'Venda',
            status: 'approved',
            visibility: 'PUBLIC',
            lifecycle_status: 'AVAILABLE',
            is_promoted: 0,
            promo_percentage_resolved: null,
            promo_start_date_resolved: null,
            promo_end_date_resolved: null,
            price: 950000,
            price_sale: 950000,
            price_rent: null,
            promotion_price: null,
            promotional_rent_price: null,
            promotional_rent_percentage: null,
            code: 'SC-50102',
            public_code: 'SC2HAC',
            public_id: '123e4567-e89b-12d3-a456-426614174999',
            owner_name: 'Corretor',
            owner_phone: '64999990000',
            address: 'Estrada Rural',
            cep: '75999000',
            quadra: 'Q9',
            lote: 'L1',
            numero: '1',
            bairro: 'Sítio',
            complemento: 'Propriedade',
            sem_cep: 0,
            city: 'Brasil',
            state: 'GO',
            sem_quadra: 0,
            sem_lote: 0,
            sem_numero: 0,
            bedrooms: 0,
            bathrooms: 1,
            area_construida: 2,
            area_terreno: 1,
            area_construida_valor: 2,
            area_construida_unidade: 'ha',
            area_construida_m2: 20000,
            area_terreno_valor: 1,
            area_terreno_unidade: 'alqueire',
            area_terreno_m2: 48400,
            garage_spots: 1,
            has_wifi: 0,
            tem_piscina: 0,
            tem_energia_solar: 1,
            tem_automacao: 0,
            tem_ar_condicionado: 0,
            eh_mobiliada: 0,
            valor_condominio: 0,
            valor_iptu: 1200,
            video_url: null,
            images: 'https://cdn/field/site1.jpg',
            agency_id: 2,
            agency_name: 'Agência Rural',
            agency_logo_url: 'https://cdn/logo-rural.jpg',
            agency_address: 'Rua Verde, 10',
            agency_city: 'Brasil',
            agency_state: 'GO',
            agency_phone: '6433334444',
            broker_name: 'Corretor Rural',
            broker_phone: '64988002211',
            broker_email: 'corretor-rural@test.com',
            active_negotiation_id: null,
            active_negotiation_status: null,
            active_negotiation_value: null,
            active_negotiation_client_name: null,
            created_at: '2026-03-10 10:00:00',
            updated_at: '2026-03-11 08:00:00',
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
          id: 50102,
          area_construida_valor: 2,
          area_construida_unidade: 'hectare',
          area_construida_m2: 20000,
          area_terreno_valor: 1,
          area_terreno_unidade: 'alqueire',
          area_terreno_m2: 48400,
        },
      ],
    });
  });

  it('supports explicit unit in area filters', async () => {
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes('FROM properties p') && sql.includes('GROUP BY p.id')) {
        return [[
          {
            id: 60102,
            title: 'Fazenda Norte',
            description: 'Área útil em hectare',
            type: 'Sítio',
            purpose: 'Venda',
            status: 'approved',
            visibility: 'PUBLIC',
            lifecycle_status: 'AVAILABLE',
            is_promoted: 0,
            promo_percentage_resolved: null,
            promo_start_date_resolved: null,
            promo_end_date_resolved: null,
            price: 1200000,
            price_sale: 1200000,
            price_rent: null,
            promotion_price: null,
            promotional_rent_price: null,
            promotional_rent_percentage: null,
            code: 'SN-60102',
            public_code: 'SNH001',
            public_id: '123e4567-e89b-12d3-a456-426614174555',
            owner_name: 'Corretor',
            owner_phone: '64999990000',
            address: 'Estrada Azul',
            cep: '75900001',
            quadra: 'Q1',
            lote: 'L1',
            numero: '1',
            bairro: 'Norte',
            complemento: 'Fazenda',
            sem_cep: 0,
            city: 'Brasil',
            state: 'GO',
            sem_quadra: 0,
            sem_lote: 0,
            sem_numero: 0,
            bedrooms: 0,
            bathrooms: 1,
            area_construida: 4,
            area_terreno: 2,
            area_construida_valor: 4,
            area_construida_unidade: 'ha',
            area_construida_m2: 40000,
            area_terreno_valor: 2,
            area_terreno_unidade: 'ha',
            area_terreno_m2: 20000,
            garage_spots: 1,
            has_wifi: 0,
            tem_piscina: 0,
            tem_energia_solar: 0,
            tem_automacao: 0,
            tem_ar_condicionado: 0,
            eh_mobiliada: 0,
            valor_condominio: 0,
            valor_iptu: 0,
            video_url: null,
            images: 'https://cdn/field/fazenda.jpg',
            agency_id: 3,
            agency_name: 'Agência Fazendas',
            agency_logo_url: 'https://cdn/logo-fazenda.jpg',
            agency_address: 'Rua das Fazendas, 50',
            agency_city: 'Brasil',
            agency_state: 'GO',
            agency_phone: '6433334444',
            broker_name: 'Corretor Rural',
            broker_phone: '64988002222',
            broker_email: 'corretor-rural2@test.com',
            active_negotiation_id: null,
            active_negotiation_status: null,
            active_negotiation_value: null,
            active_negotiation_client_name: null,
            created_at: '2026-03-10 10:00:00',
            updated_at: '2026-03-11 08:00:00',
          },
        ]];
      }

      if (sql.includes('COUNT(DISTINCT p.id) AS total')) {
        return [[{ total: 1 }]];
      }

      return [[]];
    });

    const response = await request(app).get(
      '/properties?min_area_construida=2&min_area_construida_unidade=ha&max_area_terreno=2&max_area_terreno_unidade=ha',
    );
    expect(response.status).toBe(200);
    const listQuery = queryMock.mock.calls.find(([query]) =>
      String(query).includes('FROM properties p') && String(query).includes('GROUP BY p.id'),
    );
    const listParams = listQuery?.[1] as unknown[] | undefined;
    expect(Array.isArray(listParams)).toBe(true);
    expect(listParams?.some((value) => Number(value) === 20000)).toBe(true);
    expect(response.body).toMatchObject({
      properties: [
        expect.objectContaining({
          id: 60102,
          area_construida_unidade: 'hectare',
          area_construida_m2: 40000,
        }),
      ],
    });
  });

  it('orders by area_construida usando conversão interna em m²', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM properties p') && sql.includes('GROUP BY p.id')) {
        return [[
          {
            id: 70101,
            title: 'Área menor',
            description: 'Menor m² técnico',
            type: 'Casa',
            purpose: 'Venda',
            status: 'approved',
            visibility: 'PUBLIC',
            lifecycle_status: 'AVAILABLE',
            is_promoted: 0,
            promo_percentage_resolved: null,
            promo_start_date_resolved: null,
            promo_end_date_resolved: null,
            price: 300000,
            price_sale: 300000,
            price_rent: null,
            promotion_price: null,
            promotional_rent_price: null,
            promotional_rent_percentage: null,
            code: 'AR-70101',
            public_code: 'AR701A',
            public_id: '123e4567-e89b-12d3-a456-426614170101',
            owner_name: null,
            owner_phone: null,
            address: 'Rua 1',
            cep: '75900000',
            quadra: 'Q1',
            lote: 'L1',
            numero: '1',
            bairro: 'Centro',
            complemento: null,
            sem_cep: 0,
            city: 'Brasil',
            state: 'GO',
            bedrooms: 2,
            bathrooms: 1,
            area_construida: 1,
            area_terreno: 2,
            area_construida_valor: 1,
            area_construida_unidade: 'ha',
            area_construida_m2: 10000,
            area_terreno_valor: 2,
            area_terreno_unidade: 'ha',
            area_terreno_m2: 20000,
            garage_spots: 1,
            has_wifi: 0,
            tem_piscina: 0,
            tem_energia_solar: 0,
            tem_automacao: 0,
            tem_ar_condicionado: 0,
            eh_mobiliada: 0,
            amenities: '[]',
            valor_condominio: 0,
            valor_iptu: 0,
            video_url: null,
            images: null,
            agency_id: null,
            agency_name: null,
            agency_logo_url: null,
            agency_address: null,
            agency_city: null,
            agency_state: null,
            agency_phone: null,
            broker_name: 'Corretor 1',
            broker_phone: '64990000001',
            broker_email: 'corretor1@test.com',
            active_negotiation_id: null,
            active_negotiation_status: null,
            active_negotiation_value: null,
            active_negotiation_client_name: null,
            created_at: '2026-03-10 10:00:00',
            updated_at: '2026-03-11 08:00:00',
          },
          {
            id: 70102,
            title: 'Área maior',
            description: 'Maior m² técnico',
            type: 'Casa',
            purpose: 'Venda',
            status: 'approved',
            visibility: 'PUBLIC',
            lifecycle_status: 'AVAILABLE',
            is_promoted: 0,
            promo_percentage_resolved: null,
            promo_start_date_resolved: null,
            promo_end_date_resolved: null,
            price: 400000,
            price_sale: 400000,
            price_rent: null,
            promotion_price: null,
            promotional_rent_price: null,
            promotional_rent_percentage: null,
            code: 'AR-70102',
            public_code: 'AR701B',
            public_id: '123e4567-e89b-12d3-a456-426614170102',
            owner_name: null,
            owner_phone: null,
            address: 'Rua 2',
            cep: '75900001',
            quadra: 'Q2',
            lote: 'L2',
            numero: '2',
            bairro: 'Centro',
            complemento: null,
            sem_cep: 0,
            city: 'Brasil',
            state: 'GO',
            bedrooms: 3,
            bathrooms: 2,
            area_construida: 3,
            area_terreno: 4,
            area_construida_valor: 3,
            area_construida_unidade: 'ha',
            area_construida_m2: 30000,
            area_terreno_valor: 4,
            area_terreno_unidade: 'ha',
            area_terreno_m2: 40000,
            garage_spots: 2,
            has_wifi: 0,
            tem_piscina: 0,
            tem_energia_solar: 0,
            tem_automacao: 0,
            tem_ar_condicionado: 0,
            eh_mobiliada: 0,
            amenities: '[]',
            valor_condominio: 0,
            valor_iptu: 0,
            video_url: null,
            images: null,
            agency_id: null,
            agency_name: null,
            agency_logo_url: null,
            agency_address: null,
            agency_city: null,
            agency_state: null,
            agency_phone: null,
            broker_name: 'Corretor 2',
            broker_phone: '64990000002',
            broker_email: 'corretor2@test.com',
            active_negotiation_id: null,
            active_negotiation_status: null,
            active_negotiation_value: null,
            active_negotiation_client_name: null,
            created_at: '2026-03-12 10:00:00',
            updated_at: '2026-03-13 08:00:00',
          },
        ]];
      }
      if (sql.includes('COUNT(DISTINCT p.id) AS total')) {
        return [[{ total: 2 }]];
      }
      return [[]];
    });

    const response = await request(app).get('/properties?sortBy=area_construida&order=asc');
    expect(response.status).toBe(200);

    const listQuery = queryMock.mock.calls.find(([query]) =>
      String(query).includes('FROM properties p') && String(query).includes('ORDER BY'),
    );
    const sqlText = String(listQuery?.[0] ?? '');
    expect(sqlText).toContain('ORDER BY COALESCE(p.area_construida_m2, p.area_construida) ASC');
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
