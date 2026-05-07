import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  getConnectionMock,
  txMock,
  resolveUserNotificationRoleMock,
} = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test';

  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    queryMock: vi.fn(),
    getConnectionMock: vi.fn(),
    txMock: tx,
    resolveUserNotificationRoleMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
  createAdminNotification: vi.fn(),
}));

vi.mock('../../src/services/userNotificationService', () => ({
  resolveUserNotificationRole: resolveUserNotificationRoleMock,
  splitRecipientsByRole: vi.fn().mockResolvedValue({ clientIds: [], brokerIds: [] }),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 30003;
    req.userRole = 'client';
    next();
  },
  isClient: (_req: any, _res: any, next: () => void) => next(),
  isBroker: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../src/middlewares/uploadMiddleware', () => ({
  mediaUpload: {
    fields: () => (req: any, _res: any, next: () => void) => {
      req.files = {
        images: [],
        video: [],
      };
      next();
    },
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: vi.fn().mockResolvedValue({
    url: 'https://res.cloudinary.com/demo/image/upload/property.jpg',
  }),
  deleteCloudinaryAsset: vi.fn(),
}));

import { adminController } from '../../src/controllers/AdminController';

const adminPropertyRow = {
  id: 555,
  status: 'approved',
  description: 'Casa para persistir',
  price: 250000,
  price_sale: 250000,
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
  purpose: 'Venda',
  title: 'Casa',
  owner_name: 'Ana',
  owner_phone: '(64) 99999-9999',
  address: 'Rua A',
  cidade: 'Cidade',
  city: 'Cidade',
  state: 'GO',
  is_promoted: 0,
  type: 'Casa',
  quadra: '1',
  lote: '2',
  sem_quadra: 0,
  sem_lote: 0,
  sem_cep: 0,
  cep: '75900000',
  numero: '123',
  bairro: 'Centro',
  complemento: 'Fundos',
  code: 'C-900',
  amenities: '[]',
  owner_id: null,
  area_construida_valor: 100,
  area_terreno_valor: 250,
  area_construida_m2: 100,
  area_terreno_m2: 250,
  area_construida_unidade: 'm2',
  area_terreno_unidade: 'm2',
  area_construida: 100,
  area_terreno: 250,
  bedrooms: 2,
  bathrooms: 2,
  garage_spots: 1,
  has_wifi: 1,
  tem_piscina: 0,
  tem_energia_solar: 0,
  tem_automacao: 0,
  tem_ar_condicionado: 0,
  eh_mobiliada: 0,
};

describe('Rotas admin de persistencia', () => {
  const allCanonicalAmenities = [
    'Wi-Fi',
    'Piscina',
    'Energia solar',
    'Automação',
    'Ar condicionado',
    'Poço artesiano',
    'Mobiliada',
    'Elevador',
    'Academia',
    'Churrasqueira',
    'Salão de festas',
    'Quadra',
    'Condomínio fechado',
    'Aceita pets',
    'SISTEMA DE SEGURANÇA/CÂMERA',
    'Sauna',
  ];

  const adminPropertyApp = express();
  adminPropertyApp.use(express.json());
  adminPropertyApp.put('/admin/properties/:id', (req, res) =>
    adminController.updateProperty(req as any, res),
  );
  const adminCreatePropertyApp = express();
  adminCreatePropertyApp.use(express.json());
  adminCreatePropertyApp.post('/admin/properties', (req, res) =>
    adminController.createProperty(req as any, res),
  );

  const editRequestApp = express();
  editRequestApp.use(express.json());
  editRequestApp.post('/admin/property-edit-requests/:id/approve', adminController.approvePropertyEditRequest);
  const updateBrokerApp = express();
  updateBrokerApp.use(express.json());
  updateBrokerApp.put('/admin/brokers/:id', (req, res) => adminController.updateBroker(req as any, res));
  const adminPropertyDetailApp = express();
  adminPropertyDetailApp.use(express.json());
  adminPropertyDetailApp.get('/admin/properties/:id', (req, res) =>
    adminController.getPropertyDetails(req as any, res),
  );

  let propertyClientApp: express.Express | undefined;
  let createPropertyRouteInitialized = false;

  beforeAll(async () => {
    if (!createPropertyRouteInitialized) {
      const { default: propertyRoutes } = await import('../../src/routes/property.routes');
      propertyClientApp = express();
      propertyClientApp.use(express.json());
      propertyClientApp.use('/properties', propertyRoutes);
      createPropertyRouteInitialized = true;
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();

    queryMock.mockReset();
    getConnectionMock.mockResolvedValue(txMock);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    resolveUserNotificationRoleMock.mockResolvedValue('broker');
  });

  it('persiste amenities e areas no PUT /admin/properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM properties') &&
        sql.includes('WHERE id = ?') &&
        !sql.includes('LIMIT 1')
      ) {
        return [[adminPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(adminPropertyApp)
      .put('/admin/properties/555')
      .set('x-request-id', 'admin-update-property-persist')
      .send({
        title: 'Casa atualizada',
        amenities: ['Mobiliada', '2'],
        area_construida_valor: 0,
        area_terreno_valor: 2323,
        area_construida_unidade: 'm2',
        area_terreno_unidade: 'm2',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Imóvel atualizado com sucesso.' });

    const updateCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties') && String(query).includes('SET'),
    );
    const updateParams = updateCall?.[1] as unknown[];

    const hasAmenitiesPayload = updateParams.some(
      (value) => typeof value === 'string' && value.includes('Mobiliada'),
    );
    expect(hasAmenitiesPayload).toBe(true);
    expect(updateParams).toContain(0);
    expect(updateParams).toContain(2323);
    expect(updateParams).toContain('m2');
  });

  it('persiste unidade em hectares no PUT /admin/properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes('SELECT') &&
        sql.includes('FROM properties') &&
        sql.includes('WHERE id = ?') &&
        !sql.includes('LIMIT 1')
      ) {
        return [[adminPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(adminPropertyApp)
      .put('/admin/properties/555')
      .set('x-request-id', 'admin-update-property-area-hectare')
      .send({
        area_terreno_valor: 2332,
        area_terreno_unidade: 'ha',
      });

    expect(response.status).toBe(200);

    const updateCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties SET') && String(query).includes('area_terreno_valor')
    );
    const updateParams = updateCall?.[1] as unknown[];
    expect(updateParams).toContain(23320000);
    expect(updateParams).toContain('hectare');
  });

  it('allow admin createProperty with same base address and different complementos', async () => {
    let duplicateChecks = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) {
        duplicateChecks += 1;
        return duplicateChecks === 1 ? [[]] : [{ id: 990 }];
      }
      if (sql.includes('INSERT INTO properties')) {
        return [{ insertId: duplicateChecks + 1100, affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    process.env.CLOUDINARY_CLOUD_NAME = 'demo';

    const responseFirst = await request(adminCreatePropertyApp)
      .post('/admin/properties')
      .send({
        title: 'Casa para teste',
        description: 'Imóvel de teste para validação administrativa',
        type: 'Casa',
        purpose: 'Venda',
        status: 'approved',
        price_sale: 250000,
        price: 250000,
        owner_name: 'Ana',
        owner_phone: '21999990000',
        address: 'Rua Admin',
        quadra: '1',
        lote: '2',
        numero: '123',
        sem_numero: 0,
        bairro: 'Centro',
        complemento: 'Bloco A',
        city: 'Cidade',
        state: 'GO',
        cep: '75900000',
        sem_cep: 0,
        bedrooms: 2,
        bathrooms: 2,
        garage_spots: 1,
        area_construida: 100,
        area_terreno: 250,
        area_construida_unidade: 'm2',
        has_wifi: 1,
        tem_piscina: 0,
        tem_energia_solar: 0,
        tem_automacao: 0,
        tem_ar_condicionado: 0,
        eh_mobiliada: 0,
        valor_condominio: 120,
        valor_iptu: 80,
        image_urls: ['https://res.cloudinary.com/demo/image/upload/conectimovel/properties/admin/foto-1.jpg'],
      });

    const responseSecond = await request(adminCreatePropertyApp)
      .post('/admin/properties')
      .send({
        title: 'Casa para teste',
        description: 'Imóvel de teste para validação administrativa',
        type: 'Casa',
        purpose: 'Venda',
        status: 'approved',
        price_sale: 250000,
        price: 250000,
        owner_name: 'Ana',
        owner_phone: '21999990000',
        address: 'Rua Admin',
        quadra: '1',
        lote: '2',
        numero: '123',
        sem_numero: 0,
        bairro: 'Centro',
        complemento: 'Bloco B',
        city: 'Cidade',
        state: 'GO',
        cep: '75900000',
        sem_cep: 0,
        bedrooms: 2,
        bathrooms: 2,
        garage_spots: 1,
        area_construida: 100,
        area_terreno: 250,
        area_construida_unidade: 'm2',
        has_wifi: 1,
        tem_piscina: 0,
        tem_energia_solar: 0,
        tem_automacao: 0,
        tem_ar_condicionado: 0,
        eh_mobiliada: 0,
        valor_condominio: 120,
        valor_iptu: 80,
        image_urls: ['https://res.cloudinary.com/demo/image/upload/conectimovel/properties/admin/foto-2.jpg'],
      });

    expect(responseFirst.status).toBe(201);
    expect(responseSecond.status).toBe(201);
  });

  it('registra e retorna no detalhe do painel um imóvel criado por cliente com áreas 0/ preenchidas e 16 comodidades canonicas', async () => {
    let capturedInsertParams: unknown[] | null = null;
    let capturedPropertyId: number | null = null;

    queryMock.mockImplementation(async (...args: unknown[]) => {
      const sql = String(args[0] ?? '');
      const params = (args[1] as unknown[]) ?? [];

      if (
        sql.includes('SELECT id, public_id, public_code FROM properties WHERE public_id IS NULL OR public_code IS NULL LIMIT ?')
      ) {
        return [[]];
      }

      if (sql.includes('SELECT 1 FROM properties WHERE public_code')) {
        return [[]];
      }

      if (
        sql.includes('FROM properties p') &&
        sql.includes('WHERE p.id') &&
        (sql.includes('LIMIT 1') || sql.includes('LIMIT') || sql.includes('p.id = ?'))
      ) {
        if (capturedInsertParams === null || capturedPropertyId === null) {
          return [[]];
        }
        return [[
          {
            id: capturedPropertyId,
            status: 'pending_approval',
            description: 'Casa para validação do fluxo cliente',
            price: 250000,
            price_sale: 250000,
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
            purpose: 'Venda',
            code: 'SM-001',
            title: 'Casa do cliente',
            public_id: String(capturedInsertParams?.[56] ?? 'ID-0000'),
            public_code: String(capturedInsertParams?.[57] ?? 'SCODE00'),
            owner_name: 'Cliente Smoke',
            owner_phone: '64999990000',
            address: 'Rua Teste',
            city: 'Cidade',
            state: 'GO',
            bairro: 'Centro',
            complemento: null,
            sem_cep: 0,
            cep: '75900000',
            quadra: 'Q1',
            lote: 'L1',
            sem_quadra: 0,
            sem_lote: 0,
            numero: '10',
            bedrooms: 3,
            bathrooms: 2,
            area_construida: capturedInsertParams?.[37] ?? 0,
            area_terreno: capturedInsertParams?.[39] ?? 2500,
            area_construida_valor: capturedInsertParams?.[40] ?? 0,
            area_construida_unidade: String(capturedInsertParams?.[38] ?? 'm2'),
            area_terreno_valor: capturedInsertParams?.[42] ?? 2500,
            area_terreno_unidade: String(capturedInsertParams?.[43] ?? 'm2'),
            area_terreno_m2: capturedInsertParams?.[44],
            garage_spots: 1,
            has_wifi: capturedInsertParams?.[47] ?? 0,
            tem_piscina: capturedInsertParams?.[48] ?? 0,
            tem_energia_solar: capturedInsertParams?.[49] ?? 0,
            tem_automacao: capturedInsertParams?.[50] ?? 0,
            tem_ar_condicionado: capturedInsertParams?.[51] ?? 0,
            eh_mobiliada: capturedInsertParams?.[52] ?? 0,
            amenities: capturedInsertParams?.[46] ?? '[]',
            created_at: '2026-03-01 10:00:00',
            updated_at: '2026-03-02 10:00:00',
          },
        ]];
      }

      if (sql.includes('SELECT id FROM properties')) {
        return [[]];
      }

      if (sql.includes('INSERT INTO properties')) {
        capturedInsertParams = params;
        capturedPropertyId = 9012;
        return [{ insertId: capturedPropertyId, affectedRows: 1 }];
      }

      if (sql.includes('INSERT INTO property_images')) {
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SELECT id, image_url FROM property_images')) {
        return [[{ id: 1, image_url: 'https://res.cloudinary.com/demo/image/upload/properties/9012.jpg' }]];
      }

      return [[]];
    });

    const response = await request(propertyClientApp as express.Express)
      .post('/properties/client')
      .set('x-request-id', 'admin-smoke-client-panel-detail')
      .send({
        images: ['https://res.cloudinary.com/demo/image/upload/property.jpg'],
        title: 'Casa do cliente',
        description: 'Propriedade criada para validar detalhe do painel.',
        type: 'Casa',
        purpose: 'Venda',
        price: 250000,
        price_sale: 250000,
        owner_name: 'Cliente Smoke',
        owner_phone: '649 9 9999-0000',
        address: 'Rua Teste',
        city: 'Cidade',
        state: 'GO',
        bairro: 'Centro',
        cep: '75900000',
        sem_cep: 0,
        bedrooms: 3,
        bathrooms: 2,
        garage_spots: 1,
        area_construida_valor: 0,
        area_terreno_valor: 2500,
        area_construida_unidade: 'm2',
        area_terreno_unidade: 'm2',
        has_wifi: 1,
        tem_piscina: 0,
        tem_energia_solar: 0,
        tem_automacao: 0,
        tem_ar_condicionado: 0,
        eh_mobiliada: 0,
        amenities: allCanonicalAmenities,
      });

    expect(response.status).toBe(201);
    expect(response.body.propertyId).toBeDefined();

    const insertCall = queryMock.mock.calls.find(([calledSql]) => String(calledSql).includes('INSERT INTO properties'));
    const insertParams = insertCall?.[1] as unknown[];

    expect(insertParams).toBeDefined();
    expect(insertParams?.[40]).toBe(0);
    expect(insertParams?.[42]).toBe(2500);
    expect(insertParams?.[57]).toBeDefined();

    const amenitiesPayload = typeof insertParams?.[46] === 'string' ? insertParams[46] : JSON.stringify(insertParams?.[46] ?? []);
    allCanonicalAmenities.forEach((amenity) => {
      expect(amenitiesPayload).toContain(amenity);
    });

    const detailResponse = await request(adminPropertyDetailApp).get('/admin/properties/9012');
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.public_code).toBeDefined();
    expect(detailResponse.body.public_id).toBeDefined();
    expect(detailResponse.body.public_code).not.toBe('-');
    expect(detailResponse.body.owner_name).toBe('Cliente Smoke');
    expect(detailResponse.body.owner_phone).toBe('64999990000');
    expect(detailResponse.body.area_construida_valor).toBe(0);
    expect(detailResponse.body.area_terreno_valor).toBe(2500);
    expect(detailResponse.body.area_construida_unidade).toBe('m2');
    expect(detailResponse.body.area_terreno_unidade).toBe('m2');
    expect(Array.isArray(detailResponse.body.amenities)).toBe(true);
    const normalizedAmenitiesFromDetail = (detailResponse.body.amenities as string[]).slice().sort();
    expect(normalizedAmenitiesFromDetail).toHaveLength(allCanonicalAmenities.length);
    expect(normalizedAmenitiesFromDetail).toEqual(allCanonicalAmenities.slice().sort());
    expect(normalizedAmenitiesFromDetail).not.toContain('PLANEJADOS');
  });

  it('aplica aprovacao de solicitacao de edicao e persiste ALTERACOES', async () => {
    const requestRow = {
      id: 901,
      property_id: 555,
      requester_user_id: 30016,
      requester_role: 'client',
      status: 'PENDING',
      before_json: JSON.stringify({ title: 'Casa' }),
      after_json: JSON.stringify({ title: 'Casa atualizada via solicitacao' }),
      diff_json: JSON.stringify({
        title: { before: 'Casa', after: 'Casa atualizada via solicitacao' },
      }),
      field_reviews_json: null,
      review_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      property_title: 'Casa',
      property_code: 'C-900',
      requester_name: 'Maria',
    };

    txMock.query
      .mockResolvedValueOnce([[requestRow]])
      .mockResolvedValueOnce([[adminPropertyRow]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(editRequestApp).post('/admin/property-edit-requests/901/approve').send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ message: 'Solicitacao de edicao revisada com sucesso.' });

    const updatePropertyCall = txMock.query.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties') && String(query).includes('SET'),
    );
    const updateParams = updatePropertyCall?.[1] as unknown[];

    expect(updatePropertyCall).toBeDefined();
    expect(String(updatePropertyCall?.[0])).toContain('`title` = ?');
    expect(updateParams).toContain('Casa atualizada via solicitacao');
  });

  it('atualiza dados basicos do corretor em PUT /admin/brokers/:id', async () => {
    const snapshotRow = {
      id: 901,
      broker_id: 901,
      broker_status: 'approved',
      role: 'broker',
      email: 'broker-old@test.com',
    };

    txMock.query
      .mockResolvedValueOnce([[snapshotRow]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[snapshotRow]]);

    const response = await request(updateBrokerApp)
      .put('/admin/brokers/901')
      .set('x-request-id', 'admin-update-broker-persist')
      .send({
        name: 'Corretor Atualizado',
        creci: '12345-A',
        phone: '64988887777',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: 'Corretor atualizado com sucesso.',
      role: 'broker',
      status: 'approved',
    });

    const updateBrokerUserCall = txMock.query.mock.calls.find(([query]) =>
      String(query).includes('UPDATE users SET'),
    );
    const updateBrokerCall = txMock.query.mock.calls.find(([query]) =>
      String(query).includes('UPDATE brokers SET'),
    );
    const userParams = updateBrokerUserCall?.[1] as unknown[];
    const brokerParams = updateBrokerCall?.[1] as unknown[];

    expect(userParams).toContain('Corretor Atualizado');
    expect(brokerParams).toContain('12345-A');
  });
});

