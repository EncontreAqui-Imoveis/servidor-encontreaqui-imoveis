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
  authMiddleware: (_req: any, _res: any, next: () => void) => next(),
  isBroker: (_req: any, _res: any, next: () => void) => next(),
  isClient: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../src/middlewares/uploadMiddleware', () => ({
  mediaUpload: {
    fields: () => (_req: any, _res: any, next: () => void) => next(),
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

describe('GET /properties/:id active negotiation payload', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active negotiation object when property has open negotiation', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 101,
          broker_id: 30003,
          owner_id: 30003,
          title: 'Casa Teste',
          description: 'Descricao',
          type: 'Casa',
          purpose: 'Venda',
          status: 'approved',
          price: 500000,
          city: 'Rio Verde',
          state: 'GO',
          address: 'Rua 1',
          images: null,
          active_negotiation_id: '3d6d6f53-a7a1-4a0f-8ca2-2f3f1dc9a111',
          active_negotiation_status: 'PROPOSAL_SENT',
          active_negotiation_client_name: 'Cliente Teste',
          active_negotiation_value: 500000,
        },
      ],
    ]);

    const response = await request(app).get('/properties/101');

    expect(response.status).toBe(200);
    expect(response.body.active_negotiation_id).toBe(
      '3d6d6f53-a7a1-4a0f-8ca2-2f3f1dc9a111'
    );
    expect(response.body.negotiation).toEqual(
      expect.objectContaining({
        id: '3d6d6f53-a7a1-4a0f-8ca2-2f3f1dc9a111',
        status: 'PROPOSAL_SENT',
        clientName: 'Cliente Teste',
        value: 500000,
      })
    );
  });
});
