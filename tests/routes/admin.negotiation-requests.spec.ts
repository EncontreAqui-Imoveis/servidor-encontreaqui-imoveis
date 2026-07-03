import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listNegotiationRequestSummaryMock,
  listNegotiationRequestsByPropertyMock,
  isInvalidNegotiationStatusFilterMock,
  parseNegotiationStatusFilterMock,
} = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  return {
    listNegotiationRequestSummaryMock: vi.fn(),
    listNegotiationRequestsByPropertyMock: vi.fn(),
    isInvalidNegotiationStatusFilterMock: vi.fn(),
    parseNegotiationStatusFilterMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminNegotiationListingService', () => ({
  listNegotiationRequestSummary: listNegotiationRequestSummaryMock,
  listNegotiationRequestsByProperty: listNegotiationRequestsByPropertyMock,
  isInvalidNegotiationStatusFilter: isInvalidNegotiationStatusFilterMock,
  parseNegotiationStatusFilter: parseNegotiationStatusFilterMock,
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
    isInvalidNegotiationStatusFilterMock.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return false;
      const normalized = value.trim().toUpperCase();
      return normalized !== '' && normalized === 'INVALID_STATUS';
    });

    parseNegotiationStatusFilterMock.mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null;
      const normalized = value.trim().toUpperCase();
      if (!normalized || normalized === 'INVALID_STATUS') {
        return null;
      }
      return normalized === 'REJECTED' ? 'REFUSED' : normalized;
    });

    listNegotiationRequestSummaryMock.mockResolvedValue({
      page: 1,
      limit: 10,
      total: 1,
      data: [
        {
          propertyId: 101,
          propertyCode: 'EA-101',
          propertyTitle: 'Casa Alto Padrão',
          propertyAddress: 'Rua A, 10, Centro, Goiania, GO',
          propertyImageUrl: 'https://res.cloudinary.com/demo/image/upload/c_limit/w_480/q_auto/f_auto/casa.jpg',
          propertyValue: 1000000,
          proposalCount: 3,
          updatedAt: '2026-04-22T10:00:00.000Z',
          topProposal: {
            negotiationId: 'neg-1',
            value: 850000,
            clientName: 'Maria Compradora',
            createdAt: '2026-04-22T09:00:00.000Z',
          },
        },
      ],
    });

    listNegotiationRequestsByPropertyMock.mockResolvedValue({
      page: 1,
      limit: 10,
      total: 2,
      propertyId: 101,
      data: [
        {
          id: 'neg-1',
          status: 'UNDER_REVIEW',
          internalStatus: 'DOCUMENTATION_PHASE',
          propertyId: 101,
          propertyCode: 'EA-101',
          propertyTitle: 'Casa Alto Padrão',
          propertyAddress: 'Rua A, 10, Centro, Goiania, GO',
          propertyImageUrl: 'https://res.cloudinary.com/demo/image/upload/c_limit/w_480/q_auto/f_auto/casa.jpg',
          propertyValue: 1000000,
          capturingBrokerName: 'Carlos Broker',
          sellingBrokerName: null,
          sellerClientName: null,
          clientName: 'Maria Compradora',
          clientCpf: '11122233344',
          value: 850000,
          createdAt: '2026-04-22T09:00:00.000Z',
          validityDate: '2026-05-02',
          payment: {
            dinheiro: 200000,
            permuta: 0,
            financiamento: 650000,
            outros: 0,
          },
          updatedAt: '2026-04-22T10:00:00.000Z',
          approvedAt: null,
          signedDocumentId: 33,
          hasSignedProposalDocument: true,
          signedDocumentFileName: 'proposta-assinada-maria.pdf',
          draftDocumentId: null,
          draftDocumentFileName: null,
        },
      ],
    });
  });

  it('returns property grouped summary with top proposal', async () => {
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
      signedDocumentId: 33,
      signedDocumentFileName: 'proposta-assinada-maria.pdf',
    });
  });

  it('returns 400 when summary status is invalid', async () => {
    const response = await request(app)
      .get('/admin/negotiations/requests/summary?status=INVALID_STATUS');

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: 'status inválido.' });
    expect(listNegotiationRequestSummaryMock).not.toHaveBeenCalled();
    expect(listNegotiationRequestsByPropertyMock).not.toHaveBeenCalled();
  });

  it('returns 500 when summary query fails', async () => {
    listNegotiationRequestSummaryMock.mockRejectedValueOnce(
      Object.assign(new Error('Unknown column'), { code: 'ER_BAD_FIELD_ERROR' })
    );

    const response = await request(app).get('/admin/negotiations/requests/summary');

    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ error: 'Ocorreu um erro inesperado no servidor.' });
  });
});
