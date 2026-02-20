import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, queryMock } = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    txMock: tx,
    getConnectionMock: vi.fn(),
    queryMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    query: queryMock,
    execute: vi.fn(),
  },
}));

import { contractController } from '../../src/controllers/ContractController';

describe('DELETE /contracts/:id/documents/:documentId', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 30003;
    (req as any).userRole = 'broker';
    next();
  });
  app.delete('/contracts/:id/documents/:documentId', (req, res) =>
    contractController.deleteDocument(req as any, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
        return [
          [
            {
              id: 'contract-1',
              negotiation_id: 'neg-1',
              property_id: 101,
              status: 'AWAITING_DOCS',
              seller_info: {},
              buyer_info: {},
              commission_data: {},
              seller_approval_status: 'APPROVED',
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
          ],
        ];
      }

      if (
        sql.includes('FROM negotiation_documents') &&
        sql.includes('WHERE id = ? AND negotiation_id = ?')
      ) {
        return [
          [
            {
              id: 501,
              type: 'contract',
              document_type: 'doc_identidade',
              metadata_json: JSON.stringify({ side: 'seller' }),
            },
          ],
        ];
      }

      if (sql.includes('DELETE FROM negotiation_documents')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });
  });

  it('blocks deletion when document side is already approved', async () => {
    const response = await request(app).delete(
      '/contracts/contract-1/documents/501'
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('seller');
    const deleteCalls = txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes('DELETE FROM negotiation_documents')
    );
    expect(deleteCalls).toHaveLength(0);
  });
});
