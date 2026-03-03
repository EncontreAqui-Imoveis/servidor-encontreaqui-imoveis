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

describe('GET /admin/contracts response shape contracts', () => {
  const app = express();
  app.use(express.json());
  app.get('/admin/contracts', (req, res) =>
    contractController.listForAdmin(req as any, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the list payload shape consumed by ContractsModule', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('COUNT(*) AS total')) {
        return [[{ total: 1 }]];
      }

      if (sql.includes('FROM contracts c') && sql.includes('LIMIT ? OFFSET ?')) {
        return [[
          {
            id: 'contract-admin-1',
            negotiation_id: 'neg-admin-1',
            property_id: 900,
            status: 'AWAITING_DOCS',
            seller_info: JSON.stringify({
              estado_civil: 'Casado',
              profissao: 'Corretor',
              email: 'captador@test.com',
              telefone: '62999998888',
              dados_bancarios: 'Banco XPTO',
            }),
            buyer_info: JSON.stringify({
              estado_civil: 'Solteiro',
              profissao: 'Analista',
              email: 'vendedor@test.com',
              telefone: '62999997777',
            }),
            commission_data: JSON.stringify({}),
            workflow_metadata: JSON.stringify({
              signatureMethod: 'online',
            }),
            seller_approval_status: 'APPROVED_WITH_RES',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: JSON.stringify({
              reason: 'Documento legível.',
            }),
            buyer_approval_reason: null,
            created_at: '2026-03-02 09:00:00',
            updated_at: '2026-03-02 09:05:00',
            capturing_broker_id: 30001,
            selling_broker_id: 30002,
            property_title: 'Casa Contrato',
            property_code: 'RV-900',
            property_purpose: 'Venda',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
            capturing_agency_name: 'Encontre Aqui',
            capturing_agency_address: 'Rua Central, 100',
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 501,
            negotiation_id: 'neg-admin-1',
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'seller',
              originalFileName: 'identidade.pdf',
              status: 'APPROVED',
            }),
            created_at: '2026-03-02 09:02:00',
          },
          {
            id: 502,
            negotiation_id: 'neg-admin-1',
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'buyer',
              originalFileName: 'identidade_comprador.pdf',
              status: 'PENDING',
            }),
            created_at: '2026-03-02 09:03:00',
          },
        ]];
      }

      return [[]];
    });

    const response = await request(app).get('/admin/contracts?status=AWAITING_DOCS');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [
        {
          id: 'contract-admin-1',
          negotiationId: 'neg-admin-1',
          propertyId: 900,
          status: 'AWAITING_DOCS',
          propertyCode: 'RV-900',
          propertyTitle: 'Casa Contrato',
          propertyPurpose: 'Venda',
          capturingBrokerName: 'Captador',
          sellingBrokerName: 'Vendedor',
          sellerApprovalStatus: 'APPROVED_WITH_RES',
          buyerApprovalStatus: 'PENDING',
          sellerApprovalReason: {
            reason: 'Documento legível.',
          },
          agencyName: 'Encontre Aqui',
          agencyAddress: 'Rua Central, 100',
          documents: [
            {
              id: 501,
              documentType: 'doc_identidade',
              side: 'seller',
              originalFileName: 'identidade.pdf',
              downloadUrl: '/negotiations/neg-admin-1/documents/501/download',
            },
            {
              id: 502,
              documentType: 'doc_identidade',
              side: 'buyer',
              originalFileName: 'identidade_comprador.pdf',
              downloadUrl: '/negotiations/neg-admin-1/documents/502/download',
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
  });
});
