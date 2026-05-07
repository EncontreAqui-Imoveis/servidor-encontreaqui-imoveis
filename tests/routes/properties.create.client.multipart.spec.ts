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
      { name: 'amenities', value: '["mobiliada","sauna"]' },
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
      .field('code', 'ABCD5678')
      .field('amenities', 'Mobiliada')
      .field('amenities', 'Sauna');

    const response = await req;

    expect(response.status).toBe(201);
  });
});
