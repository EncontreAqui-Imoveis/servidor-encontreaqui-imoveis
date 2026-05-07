import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const adminPropertyApp = express();
  adminPropertyApp.use(express.json());
  adminPropertyApp.put('/admin/properties/:id', (req, res) =>
    adminController.updateProperty(req as any, res),
  );

  const editRequestApp = express();
  editRequestApp.use(express.json());
  editRequestApp.post('/admin/property-edit-requests/:id/approve', adminController.approvePropertyEditRequest);
  const updateBrokerApp = express();
  updateBrokerApp.use(express.json());
  updateBrokerApp.put('/admin/brokers/:id', (req, res) => adminController.updateBroker(req as any, res));

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

