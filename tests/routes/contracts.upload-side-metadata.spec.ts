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
import { contractDocumentUpload } from '../../src/middlewares/uploadMiddleware';

describe('POST /contracts/:id/documents stores side metadata', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 30003;
    (req as any).userRole = 'broker';
    next();
  });
  app.post(
    '/contracts/:id/documents',
    contractDocumentUpload.single('file'),
    (req, res) => contractController.uploadDocument(req as any, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
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

      if (sql.includes('INSERT INTO negotiation_documents')) {
        const metadataJson = String(params[3] ?? '{}');
        const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
        expect(metadata.side).toBe('seller');
        expect(String(metadata.originalFileName ?? '')).toBe('identidade.pdf');
        return [{ insertId: 999 }];
      }

      if (sql.includes('UPDATE contracts')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });
  });

  it('persists side=seller in metadata_json when uploading contract documents', async () => {
    const response = await request(app)
      .post('/contracts/contract-1/documents')
      .field('documentType', 'doc_identidade')
      .field('side', 'seller')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'identidade.pdf');

    expect(response.status).toBe(201);
    expect(response.body.document).toMatchObject({
      documentType: 'doc_identidade',
      side: 'seller',
      originalFileName: 'identidade.pdf',
    });
  });
});
