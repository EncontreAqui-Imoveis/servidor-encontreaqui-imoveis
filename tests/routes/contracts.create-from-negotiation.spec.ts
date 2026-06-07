import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const { createContractFromApprovedNegotiationMock } = vi.hoisted(() => ({
  createContractFromApprovedNegotiationMock: vi.fn(),
}));

vi.mock('../../src/services/contractCreationService', () => ({
  createContractFromApprovedNegotiation: createContractFromApprovedNegotiationMock,
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 9001;
    req.userRole = 'admin';
    next();
  },
  isAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

describe('POST /admin/negotiations/:id/contract', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: contractRoutes } = await import('../../src/routes/contract.routes');
    app = express();
    app.use(express.json());
    app.use(contractRoutes);
  }, 30_000);

  it('creates a contract from an approved negotiation and returns 201', async () => {
    createContractFromApprovedNegotiationMock.mockResolvedValueOnce({
      created: true,
      contract: {
        id: 'contract-1',
        negotiation_id: 'neg-1',
        property_id: 101,
        status: 'AWAITING_DOCS',
        seller_info: null,
        buyer_info: null,
        commission_data: null,
        seller_approval_status: 'PENDING',
        buyer_approval_status: 'PENDING',
        seller_approval_reason: null,
        buyer_approval_reason: null,
        created_at: '2026-06-01 10:00:00',
        updated_at: '2026-06-01 10:00:00',
        capturing_broker_id: 30003,
        selling_broker_id: 30004,
        seller_client_id: null,
        buyer_client_id: null,
        property_title: 'Casa Centro',
        property_purpose: 'Venda',
        property_code: 'RV-101',
        property_image_url: null,
        property_owner_id: 1,
        property_owner_name: 'Owner',
        capturing_broker_name: 'Captador',
        selling_broker_name: 'Vendedor',
        seller_client_name: null,
        buyer_client_name: null,
        capturing_agency_name: 'Agência',
        capturing_agency_address: 'Rua A',
        responsible_user_ids: null,
      },
    });

    const response = await request(app).post('/admin/negotiations/neg-1/contract');

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      message: 'Contrato criado com sucesso.',
      contract: {
        id: 'contract-1',
        negotiationId: 'neg-1',
        status: 'AWAITING_DOCS',
      },
    });
    expect(createContractFromApprovedNegotiationMock).toHaveBeenCalledWith('neg-1', expect.any(Object));
  });

  it('returns 500 when the contract service rejects and the controller falls back', async () => {
    createContractFromApprovedNegotiationMock.mockRejectedValueOnce({
      statusCode: 400,
      message: 'ID da negociação inválido.',
    });

    const response = await request(app).post('/admin/negotiations/neg-x/contract');

    expect(response.status).toBe(500);
  });
});
