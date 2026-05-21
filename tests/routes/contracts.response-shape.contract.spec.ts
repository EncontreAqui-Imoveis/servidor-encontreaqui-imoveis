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
            property_image_url: 'https://cdn.example.com/property-101.jpg',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
            buyer_client_name: 'Cliente Comprador',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Rua Central, 100 - Centro',
            responsible_user_ids: '30003,30005',
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
        approvalProgress: {
          status: 'APPROVED_WITH_RES',
          label: 'Aprovado com ressalvas',
          nextStep: 'Aguardando liberação para minuta',
        },
        propertyTitle: 'Casa Centro',
        propertyImageUrl: 'https://cdn.example.com/property-101.jpg',
        propertyPurpose: 'Aluguel',
        agencyName: 'Encontre Aqui',
        agencyAddress: 'Rua Central, 100 - Centro',
        buyerClientName: 'Cliente Comprador',
        responsibleUserIds: [30003, 30005],
        viewerSide: 'both',
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
            responsible_user_ids: '30003,30005',
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
          approvalProgress: {
            status: 'PENDING',
            label: 'Pendente',
            nextStep: 'Aguardando avaliação dos dois lados',
          },
          viewerSide: 'both',
          responsibleUserIds: [30003, 30005],
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  it('keeps rejected documents visible in the contract payload', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('WHERE c.id = ?')) {
        return [[
          {
            id: 'contract-rejected-doc',
            negotiation_id: 'neg-rejected-doc',
            property_id: 303,
            status: 'AWAITING_DOCS',
            seller_info: JSON.stringify({}),
            buyer_info: JSON.stringify({}),
            commission_data: JSON.stringify({}),
            workflow_metadata: JSON.stringify({}),
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: null,
            buyer_approval_reason: null,
            created_at: '2026-03-02 10:00:00',
            updated_at: '2026-03-02 10:05:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            property_title: 'Casa Documento Rejeitado',
            property_purpose: 'Venda',
            property_code: 'RV-303',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
            buyer_client_name: 'Cliente Comprador',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Rua Central, 100',
            responsible_user_ids: '30003',
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 77,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'seller',
              originalFileName: 'identidade_rejeitada.pdf',
              status: 'REJECTED',
              reviewStatus: 'REJECTED',
            }),
            created_at: '2026-03-02 10:01:00',
          },
        ]];
      }

      return [[]];
    });

    const response = await request(app).get('/contracts/contract-rejected-doc');

    expect(response.status).toBe(200);
    expect(response.body.documents).toHaveLength(1);
    expect(response.body.documents[0]).toMatchObject({
      id: 77,
      documentType: 'doc_identidade',
      side: 'seller',
      originalFileName: 'identidade_rejeitada.pdf',
    });
  });

  it('redacts owner sensitive fields for client viewers', async () => {
    const clientApp = express();
    clientApp.use(express.json());
    clientApp.use((req, _res, next) => {
      (req as any).userId = 90001;
      (req as any).userRole = 'client';
      next();
    });
    clientApp.get('/contracts/:id', (req, res) =>
      contractController.getById(req as any, res)
    );

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('WHERE c.id = ?')) {
        return [[
          {
            id: 'contract-redact-1',
            negotiation_id: 'neg-redact-1',
            property_id: 303,
            status: 'AWAITING_DOCS',
            seller_info: JSON.stringify({
              nome: 'Proprietario',
              dados_bancarios: 'Banco XPTO',
            }),
            buyer_info: JSON.stringify({ nome: 'Comprador' }),
            commission_data: JSON.stringify({ saleValue: 999999 }),
            workflow_metadata: JSON.stringify({}),
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: JSON.stringify({}),
            buyer_approval_reason: JSON.stringify({}),
            created_at: '2026-03-01 10:00:00',
            updated_at: '2026-03-01 10:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            buyer_client_id: 90001,
            property_owner_id: 80001,
            property_title: 'Casa Sul',
            property_purpose: 'Venda',
            property_code: 'CS-303',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Legado',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Rua Sul, 12',
            responsible_user_ids: '30003,30005',
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 7001,
            type: 'other',
            document_type: 'outro',
            metadata_json: JSON.stringify({
              side: 'seller',
              documentCategory: 'dados_bancarios',
              originalFileName: 'bank.pdf',
            }),
            created_at: '2026-03-01 11:00:00',
          },
          {
            id: 7002,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'buyer',
              documentCategory: 'identidade',
              originalFileName: 'id.pdf',
            }),
            created_at: '2026-03-01 11:01:00',
          },
        ]];
      }

      return [[]];
    });

    const response = await request(clientApp).get('/contracts/contract-redact-1');
    expect(response.status).toBe(200);
    expect(response.body.contract.ownerInfo).toEqual({ nome: 'Proprietario' });
    expect(response.body.contract.sellerInfo).toEqual({ nome: 'Proprietario' });
    expect(response.body.contract.commissionData).toEqual({});
    expect(response.body.contract.responsibleUserIds).toEqual([30003, 30005]);
    expect(response.body.documents).toEqual([
      expect.objectContaining({
        id: 7002,
        side: 'buyer',
      }),
    ]);
  });

  it('returns both-side visibility for responsible brokers in the contract detail', async () => {
    const responsibleApp = express();
    responsibleApp.use(express.json());
    responsibleApp.use((req, _res, next) => {
      (req as any).userId = 30005;
      (req as any).userRole = 'broker';
      next();
    });
    responsibleApp.get('/contracts/:id', (req, res) =>
      contractController.getById(req as any, res)
    );

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('WHERE c.id = ?')) {
        return [[
          {
            id: 'contract-responsible-1',
            negotiation_id: 'neg-responsible-1',
            property_id: 404,
            status: 'AWAITING_DOCS',
            seller_info: JSON.stringify({}),
            buyer_info: JSON.stringify({}),
            commission_data: JSON.stringify({}),
            workflow_metadata: JSON.stringify({}),
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: JSON.stringify({}),
            buyer_approval_reason: JSON.stringify({}),
            created_at: '2026-03-03 10:00:00',
            updated_at: '2026-03-03 10:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            buyer_client_id: 90001,
            property_owner_id: 80001,
            property_title: 'Casa Responsável',
            property_purpose: 'Venda',
            property_code: 'CR-404',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Rua Responsável, 10',
            responsible_user_ids: '30005,30006',
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents')) {
        return [[]];
      }

      return [[]];
    });

    const response = await request(responsibleApp).get('/contracts/contract-responsible-1');

    expect(response.status).toBe(200);
    expect(response.body.contract.responsibleUserIds).toEqual([30005, 30006]);
    expect(response.body.contract.viewerSide).toBe('both');
  });
});
