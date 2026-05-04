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
    fields: () => (req: any, _res: any, next: () => void) => {
      req.files = {
        images: [
          {
            originalname: 'front.jpg',
            mimetype: 'image/jpeg',
            size: 128,
            buffer: Buffer.from('img'),
          },
        ],
      };
      next();
    },
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: uploadToCloudinaryMock,
  deleteCloudinaryAsset: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

const description500 = `${'a'.repeat(499)}'`;
const basePayload = {
  title: 'Casa térrea',
  description: description500,
  type: 'Casa',
  purpose: 'Venda',
  price: 250000,
  price_sale: 250000,
  owner_name: 'Ana Silva',
  owner_phone: '+55 (64) 99999-9999',
  address: 'Rua A',
  numero: '123',
  bairro: 'Centro',
  complemento: 'Fundos',
  sem_cep: 0,
  city: 'Rio Verde',
  state: 'GO',
  cep: '75900000',
  bedrooms: 3,
  bathrooms: 2,
  area_construida: 180,
  area_terreno: 250,
  garage_spots: 2,
  has_wifi: 1,
  tem_piscina: 0,
  tem_energia_solar: 0,
  tem_automacao: 0,
  tem_ar_condicionado: 1,
  eh_mobiliada: 0,
};

describe('POST /properties description length contract', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    const { requestContextMiddleware } = await import('../../src/middlewares/requestContext');
    app = express();
    app.use(requestContextMiddleware);
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    uploadToCloudinaryMock.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
    });
  });

  it('accepts a description with exactly 500 characters', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 123, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'desc-500')
      .send(basePayload);

    expect(response.status).toBe(201);
    expect(response.body.propertyId).toBeDefined();

    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams).toEqual(expect.arrayContaining([description500]));
  });

  it('accepts a 500-character description even when line breaks arrive as CRLF', async () => {
    const crlfDescription = `${'a'.repeat(248)}\r\n${'b'.repeat(248)}\r\ncc`;
    expect(crlfDescription.length).toBe(502);
    expect(crlfDescription.replace(/\r\n/g, '\n').length).toBe(500);

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 124, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'desc-crlf-500')
      .send({
        ...basePayload,
        description: crlfDescription,
      });

    expect(response.status).toBe(201);
    expect(response.body.propertyId).toBeDefined();

    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams).toEqual(
      expect.arrayContaining([crlfDescription.replace(/\r\n/g, '\n')])
    );
  });

  it('accepts address number as S/N without forcing numeric digits', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 125, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'numero-sn')
      .send({
        ...basePayload,
        numero: 'S/N',
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams).toEqual(expect.arrayContaining([null]));
  });

  it('accepts quartos as 0', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 126, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'quartos-zero')
      .send({
        ...basePayload,
        bedrooms: 0,
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams?.[35]).toBe(0);
  });

  it('accepts bathrooms and garage_spots as 0', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 129, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'counts-zero')
      .send({
        ...basePayload,
        bedrooms: 1,
        bathrooms: 0,
        garage_spots: 0,
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams?.[36]).toBe(0);
    expect(insertParams?.[40]).toBe(0);
  });

  it('accepts amenities by canonical strings and legacy ids', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 127, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'amenities-compat')
      .send({
        ...basePayload,
        amenities: ['mobiliada', '1', 'Sauna'],
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(
      insertParams.some((value) => typeof value === 'string' && value.includes('MOBILIADA'))
    ).toBe(true);
  });

  it('rejects negative quartos with explicit minimum validation message', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 128, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'quartos-negative')
      .send({
        ...basePayload,
        bedrooms: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Quartos deve ser no mínimo 0.');
  });

  it('rejects negative count fields with clear minimum validation', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 130, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'count-negative')
      .send({
        ...basePayload,
        bathrooms: -2,
        garage_spots: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Banheiros deve ser no mínimo 0.');
  });

  it('rejects invalid amenity input', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM brokers')) return [[{ status: 'approved' }]];
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 131, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'amenities-invalid')
      .send({
        ...basePayload,
        amenities: ['mobiliada', 'inexistente'],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Comodidade inválida: inexistente');
  });

  it('rejects a description above 500 characters and logs the reason', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await request(app)
      .post('/properties')
      .set('x-request-id', 'desc-501')
      .send({
        ...basePayload,
        description: `${'b'.repeat(500)}c`,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Descrição deve ter entre 1 e 500 caracteres.');
    expect(queryMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'Property create validation failed:',
      expect.objectContaining({
        requestId: 'desc-501',
        flow: 'broker',
        reason: 'invalid_description_length',
      })
    );

    warnSpy.mockRestore();
  });
});
