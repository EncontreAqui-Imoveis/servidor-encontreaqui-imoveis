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
  createAdminNotification: vi.fn(),
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

const mockPropertyRow = {
  id: 555,
  broker_id: 30003,
  owner_id: null,
  title: 'Casa térrea',
  description: description500,
  type: 'Casa',
  purpose: 'Venda',
  status: 'approved',
  is_promoted: 0,
  price: 250000,
  price_sale: 250000,
  price_rent: null,
  promotion_price: null,
  promotional_rent_price: null,
  promotional_rent_percentage: null,
  promotion_percentage: null,
  promo_percentage: null,
  promo_start_date: null,
  promo_end_date: null,
  promotion_start: null,
  promotion_end: null,
  code: null,
  owner_name: 'Ana Silva',
  owner_phone: '+55 (64) 99999-9999',
  address: 'Rua A',
  bairro: 'Centro',
  complemento: 'Fundos',
  city: 'Rio Verde',
  state: 'GO',
  cep: '75900000',
  sem_cep: 0,
  bedrooms: 3,
  bathrooms: 2,
  area_construida: 180,
  area_construida_unidade: 'm2',
  area_terreno: 250,
  garage_spots: 2,
  has_wifi: 1,
  tem_piscina: 0,
  tem_energia_solar: 0,
  tem_automacao: 0,
  tem_ar_condicionado: 1,
  eh_mobiliada: 0,
  valor_condominio: null,
  valor_iptu: null,
  created_at: new Date(),
  updated_at: new Date(),
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

  it('accepts createForClient with bedrooms/bathrooms/garage_spots as 0', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 132, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-counts-zero')
      .send({
        ...basePayload,
        bedrooms: 0,
        bathrooms: 0,
        garage_spots: 0,
      });

    expect(response.status).toBe(201);
    expect(response.body.propertyId).toBeDefined();
    const insertCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams?.[35]).toBe(0);
    expect(insertParams?.[36]).toBe(0);
    expect(insertParams?.[40]).toBe(0);
  });

  it('accepts textual zero-like values on createForClient without treating as invalid', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 133, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-counts-textual-zero')
      .send({
        ...basePayload,
        bedrooms: 'zero',
        bathrooms: 'Nenhum',
        garage_spots: 'nao',
      });

    expect(response.status).toBe(201);
    expect(response.body.propertyId).toBeDefined();
    const insertCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams?.[35]).toBe(0);
    expect(insertParams?.[36]).toBe(0);
    expect(insertParams?.[40]).toBe(0);
  });

  it('rejects createForClient negative bedroom value', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 134, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-quartos-negative')
      .send({
        ...basePayload,
        bedrooms: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Quartos deve ser no mínimo 0.');
  });

  it('accepts canonical amenities on createForClient', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 135, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-amenities-compat')
      .send({
        ...basePayload,
        amenities: ['mobiliada', '1', 'SAUNA'],
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(
      insertParams.some((value) => typeof value === 'string' && value.includes('MOBILIADA'))
    ).toBe(true);
    expect(
      insertParams.some((value) => typeof value === 'string' && value.includes('SAUNA'))
    ).toBe(true);
  });

  it('accepts legacy planned amenity aliases on createForClient', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 137, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-amenities-legado-planejados')
      .send({
        ...basePayload,
        amenities: ['3', 'planejados'],
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    const amenitiesPayload = insertParams?.find((value) => typeof value === 'string' && value.includes('[\"'));
    expect(typeof amenitiesPayload).toBe('string');
    expect(String(amenitiesPayload)).toContain('PLANEJADOS');
  });

  it('rejects negative values on createForClient bathrooms/garages', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 136, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-count-negative')
      .send({
        ...basePayload,
        bathrooms: -2,
        garage_spots: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Banheiros deve ser no mínimo 0.');
  });

  it('updates property with bedrooms = 0 via PUT /properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[mockPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app)
      .put('/properties/555')
      .set('x-request-id', 'update-put-bedrooms-zero')
      .send({ bedrooms: 0 });

    expect(response.status).toBe(200);
    const updateCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties SET')
    );
    const updateParams = updateCall?.[1] as unknown[];
    expect(updateParams?.[0]).toBe(0);
    expect(updateParams?.[1]).toBe(555);
  });

  it('updates property amenities via PATCH /properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[mockPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app)
      .patch('/properties/555')
      .set('x-request-id', 'update-patch-amenities')
      .send({ amenities: ['Mobiliada', '2'] });

    expect(response.status).toBe(200);
    const updateCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties SET')
    );
    const updateParams = updateCall?.[1] as unknown[];
    expect(typeof updateParams?.[0]).toBe('string');
    expect(String(updateParams?.[0])).toContain('MOBILIADA');
    expect(updateParams?.[1]).toBe(555);
  });

  it('accepts area em hectares no limite expandido via PATCH /properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[mockPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app)
      .patch('/properties/555')
      .set('x-request-id', 'update-patch-area-ha')
      .send({
        area_construida: 1000,
        area_construida_unidade: 'hectare',
        area_terreno: 10000000,
      });

    expect(response.status).toBe(200);
    const updateCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties SET')
    );
    const updateParams = updateCall?.[1] as unknown[];
    expect(updateParams).toContain(10000000);
    expect(updateParams).toContain('hectare');
  });

  it('rejects area de terreno abaixo da área construída via PATCH /properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[mockPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app)
      .patch('/properties/555')
      .set('x-request-id', 'update-patch-area-incoerente')
      .send({
        area_construida: 999,
        area_construida_unidade: 'm2',
      });

    expect(response.status).toBe(400);
  });

  it('accepts 2332 hectares on createForClient and persists converted m²', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 138, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-area-ha')
      .send({
        ...basePayload,
        area_construida: 2332,
        area_terreno: 25000000,
        area_construida_unidade: 'ha',
      });

    expect(response.status).toBe(201);
    const insertCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('INSERT INTO properties')
    );
    const insertParams = insertCall?.[1] as unknown[];
    expect(insertParams).toContain(23320000);
  });

  it('rejects createForClient when area construída excede limite alto suportado', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 139, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      return [[]];
    });

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-area-huge')
      .send({
        ...basePayload,
        area_construida: 10000,
        area_terreno: 110000000,
        area_construida_unidade: 'ha',
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Área construída deve ser no máximo 99999999.99');
  });


  it('rejects invalid amenities on PATCH /properties/:id', async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('SELECT * FROM properties WHERE id = ?')) {
        return [[mockPropertyRow]];
      }
      if (sql.includes('UPDATE properties SET')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });

    const response = await request(app)
      .patch('/properties/555')
      .set('x-request-id', 'update-patch-amenities-invalid')
      .send({ amenities: ['inexistente'] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Comodidade inválida: inexistente');
    const updateCall = queryMock.mock.calls.find(([query]) =>
      String(query).includes('UPDATE properties SET')
    );
    expect(updateCall).toBeUndefined();
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
