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

const { storeNegotiationDocumentToR2Mock } = vi.hoisted(() => ({
  storeNegotiationDocumentToR2Mock: vi.fn(),
}));

const { deleteNegotiationDocumentObjectMock } = vi.hoisted(() => ({
  deleteNegotiationDocumentObjectMock: vi.fn(),
}));

const { enqueueNegotiationDocumentDeletionMock } = vi.hoisted(() => ({
  enqueueNegotiationDocumentDeletionMock: vi.fn(),
}));

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
  createAdminNotification: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/negotiationDocumentStorageService', () => ({
  storeNegotiationDocumentToR2: storeNegotiationDocumentToR2Mock,
  readNegotiationDocumentObject: vi.fn(),
  deleteNegotiationDocumentObject: deleteNegotiationDocumentObjectMock,
  parseNegotiationDocumentMetadata: (value: unknown) =>
    value && typeof value === 'object' ? value : {},
}));

vi.mock('../../src/services/negotiationDocumentDeletionService', () => ({
  enqueueNegotiationDocumentDeletion: enqueueNegotiationDocumentDeletionMock,
}));

import { contractController } from '../../src/controllers/ContractController';
import { contractDraftUpload } from '../../src/middlewares/uploadMiddleware';

type MutableContractState = {
  id: string;
  negotiation_id: string;
  property_id: number;
  deal_type: 'sale' | 'rent';
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
    deal_type: 'sale',
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
  app.post('/contracts/:id/draft-review/:side', (req, res) => {
    const side = req.params.side === 'seller' ? 'seller' : 'buyer';
    (req as any).userId = side === 'seller' ? 7001 : 7002;
    (req as any).contractContext = {
      userRole: side,
      canReadMeta: true,
      canReadSeller: side === 'seller',
      canReadBuyer: side === 'buyer',
      canEditSeller: false,
      canEditBuyer: false,
      isReadOnly: true,
      requiresHandshakeVerification: false,
    };
    return contractController.reviewDraft(req as any, res);
  });

  let contractState: MutableContractState;
  let evidenceCounts: {
    signedContract: number;
    paymentReceipt: number;
    inspectionBoleto: number;
  };
  let draftDocumentsState: Array<{
    id: number;
    type: string;
    document_type: string | null;
    metadata_json: Record<string, unknown>;
    storage_provider: string | null;
    storage_bucket: string | null;
    storage_key: string | null;
    storage_content_type: string | null;
    storage_size_bytes: number | null;
    storage_etag: string | null;
  }>;
  let draftInsertCount: number;
  let draftReviewDecisions: Record<'seller' | 'buyer', string | null>;
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
    draftDocumentsState = [];
    draftInsertCount = 0;
    draftReviewDecisions = { seller: null, buyer: null };
    negotiationStatusUpdate = null;
    propertyStatusUpdate = null;

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    createUserNotificationMock.mockResolvedValue(undefined);
    storeNegotiationDocumentToR2Mock.mockResolvedValue(98001);

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
          sql.includes('UPDATE contracts') &&
          sql.includes("SET status = 'AWAITING_MINUTE_REVIEW'")
        ) {
          contractState.status = 'AWAITING_MINUTE_REVIEW';
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT id FROM contract_draft_revisions')) {
          return [[{ id: 91 }]];
        }

        if (
          sql.includes('FROM contract_draft_reviews') &&
          sql.includes('reviewer_side = ?') &&
          sql.includes('FOR UPDATE')
        ) {
          const side = String(params[1] ?? '') as 'seller' | 'buyer';
          return draftReviewDecisions[side]
            ? [[{ id: side === 'seller' ? 1 : 2 }]]
            : [[]];
        }

        if (sql.includes('INSERT INTO contract_draft_reviews')) {
          const side = String(params[3] ?? '') as 'seller' | 'buyer';
          draftReviewDecisions[side] = String(params[4] ?? '');
          return [{ affectedRows: 1 }];
        }

        if (sql.includes('SELECT COUNT(*) AS consent_count')) {
          return [[{
            consent_count: Object.values(draftReviewDecisions)
              .filter((decision) => decision === 'CONSENTED').length,
          }]];
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
          sql.includes('FROM negotiation_documents') &&
          sql.includes('storage_provider') &&
          sql.includes('ORDER BY id DESC')
        ) {
          return [draftDocumentsState];
        }

        if (sql.includes('DELETE FROM negotiation_documents') && sql.includes('id IN (')) {
          const ids = params.map((value) => Number(value));
          draftDocumentsState = draftDocumentsState.filter(
            (document) => !ids.includes(Number(document.id))
          );
          return [{ affectedRows: ids.length }];
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

  it('moves contract from IN_DRAFT to minute review when draft PDF is uploaded', async () => {
    contractState = createContractState({
      status: 'IN_DRAFT',
      property_purpose: 'Venda',
    });

    const response = await request(app)
      .post('/admin/contracts/contract-1/draft')
      .field('side', 'seller')
      .attach('file', Buffer.from('%PDF-1.4 draft%'), 'minuta.pdf');

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('AWAITING_MINUTE_REVIEW');
    expect(storeNegotiationDocumentToR2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        negotiationId: 'neg-1',
        documentType: 'contrato_minuta',
        content: expect.any(Buffer),
      })
    );
    expect(createUserNotificationMock).toHaveBeenCalled();
  });

  it('permite prosseguir com a mesma minuta sem reenviar arquivo quando já existe PDF', async () => {
    contractState = createContractState({
      status: 'IN_DRAFT',
      property_purpose: 'Venda',
    });
    draftDocumentsState = [
      {
        id: 7101,
        type: 'contract',
        document_type: 'contrato_minuta',
        metadata_json: {
          contractId: 'contract-1',
          documentKind: 'contract_draft',
          dealType: 'sale',
          templateKey: 'sale_contract_v1',
          templateVersion: '1',
          isActiveContractDraft: true,
          originalFileName: 'minuta_atual.pdf',
        },
        storage_provider: 'R2',
        storage_bucket: 'contracts',
        storage_key: 'neg-1/contrato_minuta/7101',
        storage_content_type: 'application/pdf',
        storage_size_bytes: 128,
        storage_etag: 'etag-1',
      },
    ];

    const response = await request(app)
      .post('/admin/contracts/contract-1/draft')
      .field('side', 'seller')
      .field('reuseCurrentDraft', 'true');

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('AWAITING_MINUTE_REVIEW');
    expect(storeNegotiationDocumentToR2Mock).not.toHaveBeenCalled();
    expect(deleteNegotiationDocumentObjectMock).not.toHaveBeenCalled();
    expect(enqueueNegotiationDocumentDeletionMock).not.toHaveBeenCalled();
  });

  it('substitui a minuta antiga ao anexar um novo PDF', async () => {
    contractState = createContractState({
      status: 'IN_DRAFT',
      property_purpose: 'Venda',
    });
    draftDocumentsState = [
      {
        id: 7201,
        type: 'contract',
        document_type: 'contrato_minuta',
        metadata_json: {
          contractId: 'contract-1',
          documentKind: 'contract_draft',
          dealType: 'sale',
          templateKey: 'sale_contract_v1',
          templateVersion: '1',
          isActiveContractDraft: true,
          originalFileName: 'minuta_antiga.pdf',
        },
        storage_provider: 'R2',
        storage_bucket: 'contracts',
        storage_key: 'neg-1/contrato_minuta/7201',
        storage_content_type: 'application/pdf',
        storage_size_bytes: 256,
        storage_etag: 'etag-old',
      },
    ];

    const response = await request(app)
      .post('/admin/contracts/contract-1/draft')
      .field('side', 'seller')
      .attach('file', Buffer.from('%PDF-1.4 nova minuta%'), 'nova_minuta.pdf');

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('AWAITING_MINUTE_REVIEW');
    expect(storeNegotiationDocumentToR2Mock).toHaveBeenCalledTimes(1);
    expect(enqueueNegotiationDocumentDeletionMock).toHaveBeenCalledTimes(1);
    expect(draftDocumentsState).toHaveLength(0);
  });

  it('releases signatures only after buyer and seller consent to the active draft', async () => {
    contractState = createContractState({
      status: 'AWAITING_MINUTE_REVIEW',
      property_purpose: 'Venda',
    });

    const buyerResponse = await request(app)
      .post('/contracts/contract-1/draft-review/buyer')
      .send({ decision: 'CONSENTED' });
    expect(buyerResponse.status).toBe(200);
    expect(contractState.status).toBe('AWAITING_MINUTE_REVIEW');

    const sellerResponse = await request(app)
      .post('/contracts/contract-1/draft-review/seller')
      .send({ decision: 'CONSENTED' });
    expect(sellerResponse.status).toBe(200);
    expect(sellerResponse.body.contract.status).toBe('AWAITING_SIGNATURES');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
  });

  it('does not allow a side to overwrite its decision for the same minute revision', async () => {
    contractState = createContractState({
      status: 'AWAITING_MINUTE_REVIEW',
      property_purpose: 'Venda',
    });

    const firstDecision = await request(app)
      .post('/contracts/contract-1/draft-review/buyer')
      .send({ decision: 'CHANGES_REQUESTED', reason: 'Revisar a cláusula de prazo.' });
    expect(firstDecision.status).toBe(200);

    const retry = await request(app)
      .post('/contracts/contract-1/draft-review/buyer')
      .send({ decision: 'CONSENTED' });
    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('DRAFT_REVIEW_ALREADY_DECIDED');
    expect(draftReviewDecisions.buyer).toBe('CHANGES_REQUESTED');
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
    expect(response.body.error).toContain('comprovante de pagamento');
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
          valorBaseComissao: 10000,
          comissaoCaptador: 1000,
          comissaoVendedor: 5000,
          taxaPlataforma: 4000,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('FINALIZED');
    expect(contractState.commission_data).toEqual({
      valorBaseComissao: 10000,
      valorVenda: 10000,
      comissaoCaptador: 1000,
      comissaoVendedor: 5000,
      taxaPlataforma: 4000,
    });
    expect(negotiationStatusUpdate).toBe('RENTED');
    expect(propertyStatusUpdate).toEqual({
      status: 'rented',
      lifecycleStatus: 'RENTED',
      propertyId: 101,
    });
  });

  it('replays finalization with the same commission data without duplicating side effects', async () => {
    contractState = createContractState({
      status: 'AWAITING_SIGNATURES',
      property_purpose: 'Venda',
    });
    evidenceCounts = {
      signedContract: 1,
      paymentReceipt: 1,
      inspectionBoleto: 0,
    };
    const commissionData = {
      valorBaseComissao: 10000,
      comissaoCaptador: 5000,
      comissaoVendedor: 3000,
      taxaPlataforma: 2000,
    };

    const first = await request(app)
      .post('/admin/contracts/contract-1/finalize')
      .send({ commissionData });
    const second = await request(app)
      .post('/admin/contracts/contract-1/finalize')
      .send({ commissionData });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes("status = 'FINALIZED'")
    )).toHaveLength(1);
  });

  it('rejects a finalization retry with different commission data', async () => {
    contractState = createContractState({
      status: 'FINALIZED',
      property_purpose: 'Venda',
      commission_data: {
        valorBaseComissao: 10000,
        valorVenda: 10000,
        comissaoCaptador: 5000,
        comissaoVendedor: 3000,
        taxaPlataforma: 2000,
      },
    });

    const response = await request(app)
      .post('/admin/contracts/contract-1/finalize')
      .send({
        commissionData: {
          valorBaseComissao: 10000,
          comissaoCaptador: 4000,
          comissaoVendedor: 4000,
          taxaPlataforma: 2000,
        },
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CONTRACT_ALREADY_FINALIZED_WITH_DIFFERENT_COMMISSION');
    expect(txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes("status = 'FINALIZED'")
    )).toHaveLength(0);
  });

  it('rejects finalization when financial split exceeds the commission base', async () => {
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
          valorBaseComissao: 10000,
          comissaoCaptador: 7000,
          comissaoVendedor: 2500,
          taxaPlataforma: 1000,
        },
      });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('inconsistentes');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
  });

  it('rejects sale finalization when financial split is below 100% of the commission base', async () => {
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
          valorBaseComissao: 10000,
          comissaoCaptador: 4000,
          comissaoVendedor: 3000,
          taxaPlataforma: 2000,
        },
      });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('fechar exatamente o valor base da comissão');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
  });

  it('informs exactly when payment proof is missing', async () => {
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
          valorVenda: 10000,
          comissaoCaptador: 5000,
          comissaoVendedor: 3000,
          taxaPlataforma: 2000,
        },
      });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('comprovante de pagamento');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
  });
});
