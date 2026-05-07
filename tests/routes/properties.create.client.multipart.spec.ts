import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, uploadToCloudinaryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  uploadToCloudinaryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    getConnection: vi.fn(),
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 30003;
    req.userRole = 'client';
    next();
  },
  isBroker: (_req: any, _res: any, next: () => void) => next(),
  isClient: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: uploadToCloudinaryMock,
  deleteCloudinaryAsset: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
  createAdminNotification: vi.fn(),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

describe('POST /properties/client multipart payload with field-count pressure', () => {
  const app = express();

  beforeAll(async () => {
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    const { requestContextMiddleware } = await import('../../src/middlewares/requestContext');
    app.use(requestContextMiddleware);
    app.use('/properties', propertyRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a realistic client multipart payload with 2 images and many fields', async () => {

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 700, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });
    uploadToCloudinaryMock.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/property.jpg',
    });

    const payloadFields: Array<{ name: string; value: string }> = [
      { name: 'title', value: 'Casa com área grande' },
      { name: 'description', value: 'Descricao para teste de limite de campos.' },
      { name: 'type', value: 'Casa' },
      { name: 'purpose', value: 'Venda' },
      { name: 'price', value: '150000' },
      { name: 'owner_name', value: 'Cliente Teste' },
      { name: 'owner_phone', value: '21999990000' },
      { name: 'address', value: 'Rua Realista' },
      { name: 'cidade', value: 'Cidade' },
      { name: 'city', value: 'Cidade' },
      { name: 'state', value: 'GO' },
      { name: 'bairro', value: 'Centro' },
      { name: 'cep', value: '75900000' },
      { name: 'sem_cep', value: '0' },
      { name: 'bedrooms', value: '0' },
      { name: 'bathrooms', value: '0' },
      { name: 'garage_spots', value: '0' },
      { name: 'area', value: '250' },
      { name: 'area_terreno', value: '2500' },
      { name: 'area_construida', value: '10' },
      { name: 'area_unidade', value: 'm2' },
      { name: 'area_valor', value: '10' },
      { name: 'area_terreno_valor', value: '2500' },
      { name: 'area_construida_valor', value: '10' },
      { name: 'area_terreno_unidade', value: 'm2' },
      { name: 'area_construida_unidade', value: 'm2' },
      { name: 'has_wifi', value: '0' },
      { name: 'tem_piscina', value: '0' },
      { name: 'tem_energia_solar', value: '0' },
      { name: 'tem_automacao', value: '0' },
      { name: 'tem_ar_condicionado', value: '0' },
      { name: 'eh_mobiliada', value: '0' },
      { name: 'valor_condominio', value: '100' },
      { name: 'valor_iptu', value: '80' },
      { name: 'complemento', value: 'Bloco A' },
      { name: 'quadra', value: '10A' },
      { name: 'lote', value: '20B' },
      { name: 'numero', value: '123' },
      { name: 'sem_quadra', value: '0' },
      { name: 'sem_lote', value: '0' },
      { name: 'sem_numero', value: '0' },
      { name: 'code', value: 'ABCD1234' },
      { name: 'video', value: 'false' },
      {
        name: 'amenities',
        value:
          '["Wi-Fi","Piscina","Energia solar","Automação","Ar condicionado","Poço artesiano","Mobiliada","Elevador","Academia","Churrasqueira","Salão de festas","Quadra","Condomínio fechado","Aceita pets","SISTEMA DE SEGURANÇA/CÂMERA","Sauna"]',
      },
    ];

    for (let index = 0; index < 22; index += 1) {
      payloadFields.push({ name: `compat_field_${index + 1}`, value: `compat-value-${index + 1}` });
    }

    const totalTextFields = payloadFields.length;
    expect(totalTextFields).toBeGreaterThan(50);

    let req = request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-multipart-realistic')
      .attach('images', Buffer.from('image-1'), 'imagem1.jpg')
      .attach('images', Buffer.from('image-2'), 'imagem2.jpg');

    for (const field of payloadFields) {
      req = req.field(field.name, field.value);
    }

    const response = await req;

    expect(response.status).toBe(201);
  });

  it('accepts amenity values sent as repeated multipart fields', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 701, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });
    uploadToCloudinaryMock.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/property.jpg',
    });

    let req = request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-multipart-repeated-amenities')
      .attach('images', Buffer.from('image-1'), 'imagem1.jpg');

    req = req.field('title', 'Casa com áreas')
      .field('description', 'Descricao para teste de amenities repetidas.')
      .field('type', 'Casa')
      .field('purpose', 'Venda')
      .field('price', '150000')
      .field('owner_name', 'Cliente Repetido')
      .field('owner_phone', '21999990000')
      .field('address', 'Rua Repetida')
      .field('city', 'Cidade')
      .field('state', 'GO')
      .field('bairro', 'Centro')
      .field('cep', '75900000')
      .field('sem_cep', '0')
      .field('bedrooms', '1')
      .field('bathrooms', '1')
      .field('garage_spots', '1')
      .field('area', '250')
      .field('area_terreno', '2500')
      .field('area_construida_valor', '10')
      .field('area_terreno_valor', '2500')
      .field('area_terreno_unidade', 'm2')
      .field('area_construida_unidade', 'm2')
      .field('has_wifi', '0')
      .field('tem_piscina', '0')
      .field('tem_energia_solar', '0')
      .field('tem_automacao', '0')
      .field('tem_ar_condicionado', '0')
      .field('eh_mobiliada', '0')
      .field('valor_condominio', '100')
      .field('valor_iptu', '80')
      .field('complemento', 'Bloco B')
      .field('quadra', '11A')
      .field('lote', '22B')
      .field('numero', '123')
      .field('sem_quadra', '0')
      .field('sem_lote', '0')
      .field('sem_numero', '0')
      .field('code', 'ABCD5678');

    const repeatedAmenities = [
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

    for (const amenity of repeatedAmenities) {
      req = req.field('amenities', amenity);
    }

    const response = await req;

    expect(response.status).toBe(201);
  });

  it('permite dois imóveis /properties/client com mesmo endereço base e complemento diferente', async () => {
    let duplicateChecks = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) {
        duplicateChecks += 1;
        return duplicateChecks === 1 ? [[]] : [{ id: 901 }];
      }
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 7010, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });
    uploadToCloudinaryMock.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/property.jpg',
    });

    const requestPayload = {
      title: 'Apartamento urbano',
      description: 'Descricao para teste de complemento no cliente.',
      type: 'Apartamento',
      purpose: 'Venda',
      price: '150000',
      owner_name: 'Cliente Teste',
      owner_phone: '21999990000',
      address: 'Rua Repetida',
      city: 'Cidade',
      state: 'GO',
      bairro: 'Centro',
      cep: '75900000',
      sem_cep: '0',
      bedrooms: '2',
      bathrooms: '2',
      garage_spots: '2',
      area: '250',
      area_terreno: '2500',
      area_construida: '10',
      area_unidade: 'm2',
      area_valor: '10',
      area_terreno_valor: '2500',
      area_construida_valor: '10',
      area_terreno_unidade: 'm2',
      area_construida_unidade: 'm2',
      has_wifi: '0',
      tem_piscina: '0',
      tem_energia_solar: '0',
      tem_automacao: '0',
      tem_ar_condicionado: '0',
      eh_mobiliada: '0',
      valor_condominio: '100',
      valor_iptu: '80',
      quadra: '10A',
      lote: '20B',
      numero: '123',
      sem_quadra: '0',
      sem_lote: '0',
      sem_numero: '0',
      code: 'ABCD1234',
      video: 'false',
    };

    const buildMultipartClientRequest = (payload: Record<string, string>, requestId: string) => {
      let req = request(app)
        .post('/properties/client')
        .set('x-request-id', requestId)
        .attach('images', Buffer.from('image-1'), 'imagem1.jpg');

      for (const [name, value] of Object.entries(payload)) {
        req = req.field(name, value);
      }

      return req;
    };

    const firstResponse = await buildMultipartClientRequest(
      { ...requestPayload, complemento: 'Bloco A' },
      'client-multipart-same-address-complemento-1',
    );
    const secondResponse = await buildMultipartClientRequest(
      { ...requestPayload, complemento: 'Bloco B' },
      'client-multipart-same-address-complemento-2',
    );

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(firstResponse.body.propertyId).toBeDefined();
    expect(secondResponse.body.propertyId).toBeDefined();
  });

  it('aceita /properties/client com título repetido para imóveis distintos', async () => {
    let duplicateChecks = 0;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) {
        duplicateChecks += 1;
        return duplicateChecks <= 1 ? [[]] : [{ id: 902 }];
      }
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 7020, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });
    uploadToCloudinaryMock.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/property.jpg',
    });

    const buildMultipartClientRequest = (title: string, requestId: string) => {
      let req = request(app)
        .post('/properties/client')
        .set('x-request-id', requestId)
        .attach('images', Buffer.from('image-1'), 'imagem1.jpg');

      const fields = [
        ['title', title],
        ['description', 'Descricao para teste de titulo repetido.'],
        ['type', 'Casa'],
        ['purpose', 'Venda'],
        ['price', '120000'],
        ['owner_name', 'Cliente Repetido'],
        ['owner_phone', '21999990000'],
        ['address', 'Rua Titulo'],
        ['city', 'Cidade'],
        ['state', 'GO'],
        ['bairro', 'Centro'],
        ['cep', '75900000'],
        ['sem_cep', '0'],
        ['bedrooms', '1'],
        ['bathrooms', '1'],
        ['garage_spots', '1'],
        ['area', '120'],
        ['area_terreno', '250'],
        ['area_construida', '60'],
        ['area_unidade', 'm2'],
        ['area_valor', '120'],
        ['area_terreno_valor', '250'],
        ['area_construida_valor', '60'],
        ['area_terreno_unidade', 'm2'],
        ['area_construida_unidade', 'm2'],
        ['has_wifi', '0'],
        ['tem_piscina', '0'],
        ['tem_energia_solar', '0'],
        ['tem_automacao', '0'],
        ['tem_ar_condicionado', '0'],
        ['eh_mobiliada', '0'],
        ['valor_condominio', '100'],
        ['valor_iptu', '80'],
        ['complemento', 'Apto 101'],
        ['quadra', '11A'],
        ['lote', '22B'],
        ['numero', '123'],
        ['sem_quadra', '0'],
        ['sem_lote', '0'],
        ['sem_numero', '0'],
        ['code', 'ABCD5678'],
      ];

      for (const [name, value] of fields) {
        req = req.field(name, value);
      }

      return req;
    };

    const firstResponse = await buildMultipartClientRequest('Casa com titulo repetido', 'client-multipart-title-1');
    const secondResponse = await buildMultipartClientRequest('Casa com titulo repetido', 'client-multipart-title-2');

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
  });
});
