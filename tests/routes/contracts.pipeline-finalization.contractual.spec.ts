import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, queryMock, createUserNotificationMock } =
  vi.hoisted(() => {
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
      createUserNotificationMock: vi.fn(),
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

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: createUserNotificationMock,
  notifyAdmins: vi.fn(),
}));

import { contractController } from '../../src/controllers/ContractController';
import { contractDraftUpload } from '../../src/middlewares/uploadMiddleware';

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

function createContractState(
  overrides: Partial<MutableContractState> = {}
): MutableContractState {
  return {
    id: 'contract-1',
    negotiation_id: 'neg-1',
    property_id: 101,
    status: 'IN_DRAFT',
    seller_info: {},
    buyer_info: {},
    commission_data: {},
    seller_approval_status: 'APPROVED',
    buyer_approval_status: 'APPROVED',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-02-20 10:00:00',
    updated_at: '2026-02-20 10:00:00',
    capturing_broker_id: 30001,
    selling_broker_id: 30002,
    property_title: 'Casa Centro',
    property_purpose: 'Venda',
    property_code: 'RV-101',
    capturing_broker_name: 'Captador',
    selling_broker_name: 'Vendedor',
    ...overrides,
  };
}

describe('Contractual compliance: contract pipeline and finalization', () => {
  const app = express();
  app.use(express.json());
  app.post(
    '/admin/contracts/:id/draft',
    contractDraftUpload.single('file'),
    (req, res) => contractController.uploadDraft(req as any, res)
  );
  app.post('/admin/contracts/:id/finalize', (req, res) =>
    contractController.finalize(req as any, res)
  );

  let contractState: MutableContractState;
  let evidenceCounts: {
    signedContract: number;
    paymentReceipt: number;
    inspectionBoleto: number;
  };
  let draftInsertCount: number;
  let negotiationStatusUpdate: string | null;
  let propertyStatusUpdate: {
    status: string;
    lifecycleStatus: string;
    propertyId: number;
  } | null;

  beforeEach(() => {
    vi.clearAllMocks();

    contractState = createContractState();
    evidenceCounts = {
      signedContract: 0,
      paymentReceipt: 0,
      inspectionBoleto: 0,
    };
    draftInsertCount = 0;
    negotiationStatusUpdate = null;
    propertyStatusUpdate = null;

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    createUserNotificationMock.mockResolvedValue(undefined);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
          return [[{ ...contractState }]];
        }

        if (
          sql.includes('INSERT INTO negotiation_documents') &&
          sql.includes("'contrato_minuta'")
        ) {
          draftInsertCount += 1;
          return [{ insertId: 98001 }];
        }

        if (
          sql.includes('UPDATE contracts') &&
          sql.includes("SET status = 'AWAITING_SIGNATURES'")
        ) {
          contractState.status = 'AWAITING_SIGNATURES';
          return [{ affectedRows: 1 }];
        }

        if (
          sql.includes('FROM negotiation_documents') &&
          sql.includes('signed_contract_total')
        ) {
          return [[
            {
              signed_contract_total: evidenceCounts.signedContract,
              payment_receipt_total: evidenceCounts.paymentReceipt,
              inspection_boleto_total: evidenceCounts.inspectionBoleto,
            },
          ]];
        }

        if (
          sql.includes('UPDATE contracts') &&
          sql.includes("status = 'FINALIZED'")
        ) {
          contractState.commission_data = JSON.parse(String(params[0] ?? '{}'));
          contractState.status = 'FINALIZED';
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('UPDATE negotiations') && sql.includes('SET status = ?')) {
          negotiationStatusUpdate = String(params[0] ?? '');
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('UPDATE properties') && sql.includes('lifecycle_status = ?')) {
          propertyStatusUpdate = {
            status: String(params[0] ?? ''),
            lifecycleStatus: String(params[1] ?? ''),
            propertyId: Number(params[2] ?? 0),
          };
          return [{ affectedRows: 1 }];
        }

        return [[]];
      }
    );
  });

  it('moves contract from IN_DRAFT to AWAITING_SIGNATURES when draft PDF is uploaded', async () => {
    contractState = createContractState({
      status: 'IN_DRAFT',
      property_purpose: 'Venda',
    });

    const response = await request(app)
      .post('/admin/contracts/contract-1/draft')
      .attach('file', Buffer.from('%PDF-1.4 draft%'), 'minuta.pdf');

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('AWAITING_SIGNATURES');
    expect(draftInsertCount).toBe(1);
    expect(createUserNotificationMock).toHaveBeenCalled();
  });

  it('blocks finalization when signed contract or payment proof is missing', async () => {
    contractState = createContractState({
      status: 'AWAITING_SIGNATURES',
      property_purpose: 'Venda',
    });
    evidenceCounts = {
      signedContract: 1,
      paymentReceipt: 0,
      inspectionBoleto: 0,
    };

    const response = await request(app)
      .post('/admin/contracts/contract-1/finalize')
      .send({
        commissionData: {
          valorVenda: 500000,
          comissaoCaptador: 15000,
          comissaoVendedor: 10000,
          taxaPlataforma: 2500,
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('contrato assinado');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
    expect(negotiationStatusUpdate).toBeNull();
    expect(propertyStatusUpdate).toBeNull();
  });

  it('finalizes rental contract, persists commission data and updates property/negotiation to RENTED', async () => {
    contractState = createContractState({
      status: 'AWAITING_SIGNATURES',
      property_purpose: 'Aluguel',
    });
    evidenceCounts = {
      signedContract: 1,
      paymentReceipt: 1,
      inspectionBoleto: 0,
    };

    const response = await request(app)
      .post('/admin/contracts/contract-1/finalize')
      .send({
        commissionData: {
          valorVenda: 10000,
          comissaoCaptador: 600,
          comissaoVendedor: 400,
          taxaPlataforma: 200,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('FINALIZED');
    expect(response.body.contract.commissionData).toEqual({
      valorVenda: 10000,
      comissaoCaptador: 600,
      comissaoVendedor: 400,
      taxaPlataforma: 200,
    });
    expect(negotiationStatusUpdate).toBe('RENTED');
    expect(propertyStatusUpdate).toEqual({
      status: 'rented',
      lifecycleStatus: 'RENTED',
      propertyId: 101,
    });
  });

  it('rejects finalization when financial split exceeds valorVenda', async () => {
    contractState = createContractState({
      status: 'AWAITING_SIGNATURES',
      property_purpose: 'Venda',
    });
    evidenceCounts = {
      signedContract: 1,
      paymentReceipt: 1,
      inspectionBoleto: 0,
    };

    const response = await request(app)
      .post('/admin/contracts/contract-1/finalize')
      .send({
        commissionData: {
          valorVenda: 10000,
          comissaoCaptador: 7000,
          comissaoVendedor: 2500,
          taxaPlataforma: 1000,
        },
      });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('inconsistentes');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
  });
});
