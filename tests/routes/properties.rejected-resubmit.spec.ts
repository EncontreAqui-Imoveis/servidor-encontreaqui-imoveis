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
    fields: () => (_req: any, _res: any, next: () => void) => next(),
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: vi.fn(),
  createAdminNotification: vi.fn(),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn(),
  notifyPromotionStarted: vi.fn(),
}));

function baseRejectedProperty() {
  return {
    id: 101,
    broker_id: 30003,
    owner_id: null,
    title: 'Casa Teste',
    description: 'Descrição válida do imóvel com tamanho adequado para validação.',
    type: 'Casa',
    status: 'rejected',
    purpose: 'Venda',
    address: 'Rua A',
    city: 'Rio Verde',
    state: 'GO',
    bairro: 'Centro',
    cep: '75900000',
    sem_cep: 0,
    price: 500000,
    price_sale: 500000,
    price_rent: null,
    is_promoted: 0,
    promo_percentage: null,
    promotion_percentage: null,
    valor_condominio: null,
    valor_iptu: null,
    commission_rate: null,
  };
}

describe('Imóvel rejeitado — reenvio', () => {
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

  it('PATCH /properties/:id inclui pending_approval e limpa motivo ao editar rejeitado', async () => {
    queryMock.mockResolvedValueOnce([[baseRejectedProperty()]]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).patch('/properties/101').send({
      title: 'Casa reenviada',
    });

    expect(response.status).toBe(200);
    const updateSql = String(queryMock.mock.calls[1]?.[0] ?? '');
    const updateParams = queryMock.mock.calls[1]?.[1] as unknown[];
    expect(updateSql).toContain("status = ?");
    expect(updateSql).toContain('rejection_reason = ?');
    expect(updateSql).toContain('visibility = ?');
    expect(updateParams).toEqual(
      expect.arrayContaining(['Casa reenviada', 'pending_approval', null, 'HIDDEN', 101])
    );
  });

  it('POST /properties/:id/resubmit-approval reenvia imóvel rejeitado', async () => {
    queryMock.mockResolvedValueOnce([[baseRejectedProperty()]]);
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).post('/properties/101/resubmit-approval').send();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('pending_approval');
    const updateSql = String(queryMock.mock.calls[1]?.[0] ?? '');
    expect(updateSql).toContain("status = 'pending_approval'");
    expect(updateSql).toContain('rejection_reason = NULL');
  });

  it('POST resubmit-approval retorna 409 se imóvel não está rejeitado', async () => {
    const row = { ...baseRejectedProperty(), status: 'approved' as const };
    queryMock.mockResolvedValueOnce([[row]]);

    const response = await request(app).post('/properties/101/resubmit-approval').send();

    expect(response.status).toBe(409);
    expect(queryMock.mock.calls.length).toBe(1);
  });
});
