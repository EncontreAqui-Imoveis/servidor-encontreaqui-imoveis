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

type MutableContractState = {
  id: string;
  negotiation_id: string;
  property_id: number;
  status: string;
  seller_info: Record<string, unknown>;
  buyer_info: Record<string, unknown>;
  commission_data: Record<string, unknown>;
  seller_approval_status: string;
  buyer_approval_status: string;
  seller_approval_reason: Record<string, unknown> | null;
  buyer_approval_reason: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  capturing_broker_id: number;
  selling_broker_id: number;
  property_title: string;
  property_purpose: string;
  property_code: string;
  capturing_broker_name: string;
  selling_broker_name: string;
};

function createInitialContractState(
  overrides: Partial<MutableContractState> = {}
): MutableContractState {
  return {
    id: 'contract-1',
    negotiation_id: 'neg-1',
    property_id: 101,
    status: 'AWAITING_DOCS',
    seller_info: { estado_civil: 'Casado' },
    buyer_info: { estado_civil: 'Solteiro' },
    commission_data: {},
    seller_approval_status: 'PENDING',
    buyer_approval_status: 'PENDING',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-02-19 10:00:00',
    updated_at: '2026-02-19 10:00:00',
    capturing_broker_id: 30001,
    selling_broker_id: 30002,
    property_title: 'Casa Centro',
    property_purpose: 'Venda',
    property_code: 'RV-101',
    capturing_broker_name: 'Captador Teste',
    selling_broker_name: 'Vendedor Teste',
    ...overrides,
  };
}

describe('Contract granular approval and signed docs endpoints', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 1;
    (req as any).userRole = 'admin';
    next();
  });
  app.put('/admin/contracts/:id/evaluate-side', (req, res) =>
    contractController.evaluateSide(req as any, res)
  );
  app.post(
    '/admin/contracts/:id/signed-docs',
    contractDocumentUpload.single('file'),
    (req, res) => contractController.uploadSignedDocs(req as any, res)
  );

  let contractState: MutableContractState;

  beforeEach(() => {
    vi.clearAllMocks();
    contractState = createInitialContractState();

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
          return [[{ ...contractState }]];
        }

        if (sql.includes('UPDATE contracts') && sql.includes('seller_approval_status')) {
          contractState.seller_approval_status = String(params[0]);
          contractState.buyer_approval_status = String(params[1]);
          contractState.seller_approval_reason = JSON.parse(
            String(params[2] ?? 'null')
          );
          contractState.buyer_approval_reason = JSON.parse(
            String(params[3] ?? 'null')
          );
          contractState.status = String(params[4]);
          return [{ affectedRows: 1 }];
        }

        if (
          sql.includes('UPDATE contracts') &&
          sql.includes('updated_at = CURRENT_TIMESTAMP')
        ) {
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('INSERT INTO negotiation_documents')) {
          return [{ insertId: 90001 }];
        }

        return [[]];
      }
    );
  });

  it('keeps AWAITING_DOCS when seller is approved and buyer is still pending', async () => {
    const response = await request(app)
      .put('/admin/contracts/contract-1/evaluate-side')
      .send({
        side: 'seller',
        status: 'APPROVED',
      });

    expect(response.status).toBe(200);
    expect(response.body.movedToDraft).toBe(false);
    expect(response.body.contract.status).toBe('AWAITING_DOCS');
    expect(response.body.contract.sellerApprovalStatus).toBe('APPROVED');
    expect(response.body.contract.buyerApprovalStatus).toBe('PENDING');
  });

  it('moves to IN_DRAFT only when both sides are approved', async () => {
    const firstResponse = await request(app)
      .put('/admin/contracts/contract-1/evaluate-side')
      .send({
        side: 'seller',
        status: 'APPROVED',
      });

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.contract.status).toBe('AWAITING_DOCS');

    const secondResponse = await request(app)
      .put('/admin/contracts/contract-1/evaluate-side')
      .send({
        side: 'buyer',
        status: 'APPROVED_WITH_RES',
        reason: 'Documentos válidos com ressalva contratual.',
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.movedToDraft).toBe(true);
    expect(secondResponse.body.contract.status).toBe('IN_DRAFT');
    expect(secondResponse.body.contract.sellerApprovalStatus).toBe('APPROVED');
    expect(secondResponse.body.contract.buyerApprovalStatus).toBe(
      'APPROVED_WITH_RES'
    );
  });

  it('allows admin signed-doc upload and returns ready-for-finalization state', async () => {
    contractState = createInitialContractState({
      status: 'AWAITING_SIGNATURES',
      seller_approval_status: 'APPROVED',
      buyer_approval_status: 'APPROVED',
    });

    const response = await request(app)
      .post('/admin/contracts/contract-1/signed-docs')
      .field('documentType', 'contrato_assinado')
      .attach('file', Buffer.from('%PDF-1.4 signed contract'), 'contrato_assinado.pdf');

    expect(response.status).toBe(201);
    expect(response.body.readyForFinalization).toBe(true);
    expect(response.body.document.documentType).toBe('contrato_assinado');
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO negotiation_documents'),
      expect.arrayContaining(['neg-1', 'contrato_assinado', expect.any(Buffer)])
    );
  });
});

