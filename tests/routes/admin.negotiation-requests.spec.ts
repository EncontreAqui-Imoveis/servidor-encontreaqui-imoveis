import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  return {
    queryMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  __esModule: true,
  default: {},
  uploadToCloudinary: vi.fn(),
  deleteCloudinaryAsset: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/priceDropNotificationService', () => ({
  notifyPriceDropIfNeeded: vi.fn().mockResolvedValue(undefined),
  notifyPromotionStarted: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: vi.fn().mockResolvedValue(null),
  resolveUserNotificationRole: vi.fn().mockReturnValue('client'),
  splitRecipientsByRole: vi.fn().mockReturnValue({
    clients: [],
    brokers: [],
    admins: [],
  }),
}));

import { adminController } from '../../src/controllers/AdminController';

describe('admin negotiation request views', () => {
  const app = express();
  app.get('/admin/negotiations/requests/summary', (req, res) =>
    adminController.listNegotiationRequestSummary(req, res)
  );
  app.get('/admin/negotiations/requests/property/:propertyId', (req, res) =>
    adminController.listNegotiationRequestsByProperty(req, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns property grouped summary with top proposal', async () => {
    queryMock
      .mockResolvedValueOnce([[{ column_name: 'client_name' }, { column_name: 'client_cpf' }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([
        [
          {
            property_id: 101,
            property_code: 'EA-101',
            property_title: 'Casa Alto Padrão',
            property_address: 'Rua A, 10, Centro, Goiania, GO',
            proposal_count: 3,
            latest_updated_at: '2026-04-22T10:00:00.000Z',
            top_negotiation_id: 'neg-1',
            top_proposal_value: 850000,
            top_client_name: 'Maria Compradora',
            top_created_at: '2026-04-22T09:00:00.000Z',
          },
        ],
      ]);

    const response = await request(app).get('/admin/negotiations/requests/summary');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 1,
    });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      propertyId: 101,
      propertyCode: 'EA-101',
      proposalCount: 3,
      topProposal: {
        negotiationId: 'neg-1',
        value: 850000,
        clientName: 'Maria Compradora',
      },
    });
  });

  it('returns paginated requests for a single property', async () => {
    queryMock
      .mockResolvedValueOnce([[{ column_name: 'client_name' }, { column_name: 'client_cpf' }]])
      .mockResolvedValueOnce([[{ total: 2 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            negotiation_status: 'DOCUMENTATION_PHASE',
            property_id: 101,
            property_status: 'approved',
            property_code: 'EA-101',
            property_title: 'Casa Alto Padrão',
            property_address: 'Rua A, 10, Centro, Goiania, GO',
            final_value: 850000,
            proposal_validity_date: '2026-05-02',
            capturing_broker_name: 'Carlos Broker',
            selling_broker_name: null,
            client_name: 'Maria Compradora',
            client_cpf: '11122233344',
            payment_dinheiro: 200000,
            payment_permuta: 0,
            payment_financiamento: 650000,
            payment_outros: 0,
            last_event_at: '2026-04-22T10:00:00.000Z',
            approved_at: null,
            signed_document_id: 33,
          },
        ],
      ]);

    const response = await request(app)
      .get('/admin/negotiations/requests/property/101?page=1&limit=10');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      page: 1,
      limit: 10,
      total: 2,
      propertyId: 101,
    });
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: 'neg-1',
      propertyId: 101,
      clientName: 'Maria Compradora',
      value: 850000,
      status: 'UNDER_REVIEW',
    });
  });

  it('returns 400 when summary status is invalid', async () => {
    const response = await request(app)
      .get('/admin/negotiations/requests/summary?status=INVALID_STATUS');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'status inválido.' });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 500 when summary query fails', async () => {
    queryMock
      .mockResolvedValueOnce([[{ column_name: 'client_name' }, { column_name: 'client_cpf' }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockRejectedValueOnce(Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' }));

    const response = await request(app).get('/admin/negotiations/requests/summary');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: 'Ocorreu um erro inesperado no servidor.' });
  });
});
