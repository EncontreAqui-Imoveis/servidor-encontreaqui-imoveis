import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}));

import { contractController } from '../../src/controllers/ContractController';

describe('Contract response shape contracts', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 30003;
    (req as any).userRole = 'broker';
    next();
  });
  app.get('/contracts/me', (req, res) =>
    contractController.listMyContracts(req as any, res)
  );
  app.get('/contracts/:id', (req, res) => contractController.getById(req as any, res));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the detail payload shape consumed by the mobile contract screen', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('WHERE c.id = ?')) {
        return [[
          {
            id: 'contract-1',
            negotiation_id: 'neg-1',
            property_id: 101,
            status: 'AWAITING_SIGNATURES',
            seller_info: JSON.stringify({ maritalStatus: 'Casado' }),
            buyer_info: JSON.stringify({ maritalStatus: 'Solteiro' }),
            commission_data: JSON.stringify({ saleValue: 350000 }),
            workflow_metadata: JSON.stringify({
              signatureMethod: 'in_person',
              agencySignedContractReceivedBy: 'admin',
            }),
            seller_approval_status: 'APPROVED',
            buyer_approval_status: 'APPROVED_WITH_RES',
            seller_approval_reason: JSON.stringify({}),
            buyer_approval_reason: JSON.stringify({
              message: 'Assinatura presencial confirmada.',
            }),
            created_at: '2026-03-01 10:00:00',
            updated_at: '2026-03-02 08:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            property_title: 'Casa Centro',
            property_purpose: 'Aluguel',
            property_code: 'RV-101',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Rua Central, 100 - Centro',
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 2,
            type: 'other',
            document_type: 'contrato_minuta',
            metadata_json: JSON.stringify({
              side: 'seller',
              originalFileName: 'minuta.pdf',
            }),
            created_at: '2026-03-02 08:01:00',
          },
        ]];
      }

      return [[]];
    });

    const response = await request(app).get('/contracts/contract-1');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      contract: {
        id: 'contract-1',
        negotiationId: 'neg-1',
        propertyId: 101,
        status: 'AWAITING_SIGNATURES',
        sellerInfo: { maritalStatus: 'Casado' },
        buyerInfo: { maritalStatus: 'Solteiro' },
        commissionData: { saleValue: 350000 },
        workflowMetadata: {
          signatureMethod: 'in_person',
          agencySignedContractReceivedBy: 'admin',
        },
        sellerApprovalStatus: 'APPROVED',
        buyerApprovalStatus: 'APPROVED_WITH_RES',
        propertyTitle: 'Casa Centro',
        propertyPurpose: 'Aluguel',
        agencyName: 'Encontre Aqui',
        agencyAddress: 'Rua Central, 100 - Centro',
      },
      documents: [
        {
          id: 2,
          type: 'other',
          documentType: 'contrato_minuta',
          side: 'seller',
          originalFileName: 'minuta.pdf',
        },
      ],
    });
  });

  it('returns list payload items in the flat shape consumed by contracts/me', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) AS total')) {
        return [[{ total: 1 }]];
      }

      if (sql.includes('FROM contracts c') && sql.includes('LIMIT ? OFFSET ?')) {
        return [[
          {
            id: 'contract-2',
            negotiation_id: 'neg-2',
            property_id: 202,
            status: 'IN_DRAFT',
            seller_info: JSON.stringify({}),
            buyer_info: JSON.stringify({}),
            commission_data: JSON.stringify({}),
            workflow_metadata: JSON.stringify({
              draftSentAt: '2026-03-02T09:00:00.000Z',
            }),
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: null,
            buyer_approval_reason: null,
            created_at: '2026-03-02 09:00:00',
            updated_at: '2026-03-02 09:05:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            property_title: 'Apartamento Norte',
            property_purpose: 'Venda',
            property_code: 'AP-202',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Av. Brasil, 200',
          },
        ]];
      }

      return [[]];
    });

    const response = await request(app).get('/contracts/me');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [
        {
          id: 'contract-2',
          negotiationId: 'neg-2',
          propertyId: 202,
          status: 'IN_DRAFT',
          workflowMetadata: {
            draftSentAt: '2026-03-02T09:00:00.000Z',
          },
          propertyTitle: 'Apartamento Norte',
          propertyPurpose: 'Venda',
          agencyName: 'Encontre Aqui',
          agencyAddress: 'Av. Brasil, 200',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
  });
});
