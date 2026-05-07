import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, createAdminNotificationMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createAdminNotificationMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 5100;
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

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: vi.fn(),
}));

describe('POST /properties/client', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createAdminNotificationMock.mockClear();
  });

  it('registra notificacao de criacao de imovel do cliente como tipo property', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM properties')) return [[]];
      if (sql.includes('INSERT INTO properties')) return [{ insertId: 900, affectedRows: 1 }];
      if (sql.includes('INSERT INTO property_images')) return [{ affectedRows: 1 }];
      if (sql.includes('SELECT email FROM users')) return [[{ email: 'cliente@test.com' }]];
      return [[]];
    });

    createAdminNotificationMock.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/properties/client')
      .set('x-request-id', 'client-notification-type')
      .send({
        title: 'Casa Teste',
        description: 'Descricao valida',
        type: 'Casa',
        purpose: 'Venda',
        price: 150000,
        owner_name: 'Cliente Teste',
        owner_phone: '64999990000',
        address: 'Rua de Exemplo',
        city: 'Rio Verde',
        state: 'GO',
        bairro: 'Centro',
        cep: '75900000',
        sem_cep: 0,
        sem_numero: 0,
        sem_quadra: 0,
        sem_lote: 0,
        numero: '100',
        bedrooms: 2,
        bathrooms: 2,
        garage_spots: 1,
        area_construida: 120,
        area_terreno: 250,
        has_wifi: 0,
        tem_piscina: 0,
        tem_energia_solar: 0,
        tem_automacao: 0,
        tem_ar_condicionado: 1,
        eh_mobiliada: 0,
        valor_condominio: 0,
        valor_iptu: 0,
        images: ['https://cdn.example.com/p1.jpg'],
      });

    expect(response.status).toBe(201);
    expect(createAdminNotificationMock).toHaveBeenCalledTimes(1);
    expect(createAdminNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'property',
        title: expect.stringContaining('cliente'),
      }),
    );
    expect(createAdminNotificationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'announcement' }),
      );
  });
});

