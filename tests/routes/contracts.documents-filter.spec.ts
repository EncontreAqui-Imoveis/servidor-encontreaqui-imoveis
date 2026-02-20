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

describe('GET /contracts/:id excludes proposal documents', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 30003;
    (req as any).userRole = 'broker';
    next();
  });
  app.get('/contracts/:id', (req, res) => contractController.getById(req as any, res));

  beforeEach(() => {
    vi.clearAllMocks();

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('WHERE c.id = ?')) {
        return [[
          {
            id: 'contract-1',
            negotiation_id: 'neg-1',
            property_id: 101,
            status: 'AWAITING_DOCS',
            seller_info: {},
            buyer_info: {},
            commission_data: {},
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: null,
            buyer_approval_reason: null,
            created_at: '2026-02-20 10:00:00',
            updated_at: '2026-02-20 10:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            property_title: 'Casa Teste',
            property_purpose: 'Venda',
            property_code: 'RV-101',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents')) {
        return [[
          {
            id: 1,
            type: 'proposal',
            document_type: 'proposal',
            metadata_json: null,
            created_at: '2026-02-20 10:00:00',
          },
          {
            id: 2,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: JSON.stringify({
              side: 'seller',
              originalFileName: 'identidade_captador.pdf',
            }),
            created_at: '2026-02-20 10:01:00',
          },
        ]];
      }

      return [[]];
    });
  });

  it('does not return items with document_type === proposal', async () => {
    const response = await request(app).get('/contracts/contract-1');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.documents)).toBe(true);
    expect(response.body.documents).toHaveLength(1);
    expect(response.body.documents[0]).toMatchObject({
      id: 2,
      documentType: 'doc_identidade',
      side: 'seller',
      originalFileName: 'identidade_captador.pdf',
    });
  });
});
