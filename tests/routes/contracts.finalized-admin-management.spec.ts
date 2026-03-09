import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, queryMock, deleteCloudinaryAssetMock } = vi.hoisted(() => {
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
    deleteCloudinaryAssetMock: vi.fn(),
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

vi.mock('../../src/config/cloudinary', () => ({
  __esModule: true,
  default: {},
  uploadToCloudinary: vi.fn(),
  deleteCloudinaryAsset: deleteCloudinaryAssetMock,
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
  commission_data: Record<string, unknown> | null;
  workflow_metadata: Record<string, unknown> | null;
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
  capturing_agency_name: string | null;
  capturing_agency_address: string | null;
};

type MutableDocument = {
  id: number;
  negotiation_id: string;
  type: string;
  document_type: string;
  metadata_json: string;
  created_at?: string;
};

function createFinalizedContractState(
  overrides: Partial<MutableContractState> = {}
): MutableContractState {
  return {
    id: 'contract-final-1',
    negotiation_id: 'neg-final-1',
    property_id: 101,
    status: 'FINALIZED',
    seller_info: {},
    buyer_info: {},
    commission_data: {
      valorVenda: 10000,
      comissaoCaptador: 5000,
      comissaoVendedor: 3000,
      taxaPlataforma: 2000,
    },
    workflow_metadata: null,
    seller_approval_status: 'APPROVED',
    buyer_approval_status: 'APPROVED',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-03-01 10:00:00',
    updated_at: '2026-03-03 10:00:00',
    capturing_broker_id: 30001,
    selling_broker_id: 30002,
    property_title: 'Casa Finalizada',
    property_purpose: 'Venda',
    property_code: 'RV-101',
    capturing_broker_name: 'Captador',
    selling_broker_name: 'Vendedor',
    capturing_agency_name: 'Encontre Aqui',
    capturing_agency_address: 'Rua Central, 100',
    ...overrides,
  };
}

describe('Admin management for finalized contracts', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 1;
    (req as any).userRole = 'admin';
    next();
  });
  app.put('/admin/contracts/:id/reopen', (req, res) =>
    contractController.reopenFinalized(req as any, res)
  );
  app.delete('/admin/contracts/:id', (req, res) =>
    contractController.deleteFinalized(req as any, res)
  );
  app.put('/admin/contracts/:id/commission-data', (req, res) =>
    contractController.updateCommissionData(req as any, res)
  );
  app.delete('/admin/contracts/:id/commission-data', (req, res) =>
    contractController.deleteCommissionData(req as any, res)
  );
  app.post(
    '/admin/contracts/:id/finalized-docs',
    contractDocumentUpload.single('file'),
    (req, res) => contractController.uploadFinalizedDocument(req as any, res)
  );
  app.delete('/admin/contracts/:id/finalized-docs/:documentId', (req, res) =>
    contractController.deleteFinalizedDocument(req as any, res)
  );

  let contractState: MutableContractState | null;
  let documentsState: MutableDocument[];
  let negotiationStatus: string;
  let propertyStatus: string;
  let propertyLifecycleStatus: string;

  beforeEach(() => {
    vi.clearAllMocks();
    contractState = createFinalizedContractState();
    documentsState = [
      {
        id: 9001,
        negotiation_id: 'neg-final-1',
        type: 'contract',
        document_type: 'contrato_assinado',
        metadata_json: JSON.stringify({
          contractId: 'contract-final-1',
          cloudinaryPublicId: 'contracts/final/contract-final-1/contrato_assinado',
          cloudinaryResourceType: 'raw',
        }),
      },
      {
        id: 9002,
        negotiation_id: 'neg-final-1',
        type: 'other',
        document_type: 'doc_identidade',
        metadata_json: JSON.stringify({
          side: 'seller',
          cloudinaryUrl:
            'https://res.cloudinary.com/demo/raw/upload/v123/contracts/final/contract-final-1/doc_identidade.pdf',
        }),
      },
      {
        id: 9003,
        negotiation_id: 'neg-final-1',
        type: 'other',
        document_type: 'outro',
        metadata_json: JSON.stringify({ contractId: 'contract-old-1' }),
      },
    ];
    negotiationStatus = 'SOLD';
    propertyStatus = 'sold';
    propertyLifecycleStatus = 'SOLD';

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    deleteCloudinaryAssetMock.mockResolvedValue({ deleted: true });

    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
        return contractState ? [[{ ...contractState }]] : [[]];
      }

      if (sql.includes('SELECT id, type, document_type, metadata_json') && sql.includes('FROM negotiation_documents')) {
        const requestedDocumentId = Number(params[0]);

        if (sql.includes('WHERE id = ?')) {
          const requestedNegotiationId = String(params[1] ?? '');
          const requestedContractId = String(params[2] ?? '');
          const doc = documentsState.find((item) => {
            if (item.id !== requestedDocumentId) return false;
            if (item.negotiation_id !== requestedNegotiationId) return false;
            const metadata = JSON.parse(item.metadata_json);
            const linkedContractId = String(metadata.contractId ?? '').trim();
            return linkedContractId === requestedContractId || !linkedContractId;
          });
          return [[doc].filter(Boolean)];
        }

        const requestedNegotiationId = String(params[0] ?? '');
        const requestedContractId = String(params[1] ?? '');
        const scopedDocs = documentsState.filter((item) => {
          if (item.negotiation_id !== requestedNegotiationId) return false;
          const metadata = JSON.parse(item.metadata_json);
          const linkedContractId = String(metadata.contractId ?? '').trim();
          return linkedContractId === requestedContractId || !linkedContractId;
        });
        return [scopedDocs];
      }

      if (sql.includes("status = 'AWAITING_DOCS'")) {
        if (contractState) {
          contractState.status = 'AWAITING_DOCS';
          contractState.seller_approval_status = 'PENDING';
          contractState.buyer_approval_status = 'PENDING';
          contractState.seller_approval_reason = null;
          contractState.buyer_approval_reason = null;
        }
        return [{ affectedRows: 1 }];
      }

      if (sql.includes("UPDATE negotiations") && sql.includes("SET status = 'IN_NEGOTIATION'")) {
        negotiationStatus = 'IN_NEGOTIATION';
        return [{ affectedRows: 1 }];
      }

      if (sql.includes("UPDATE properties") && sql.includes("status = 'negociacao'")) {
        propertyStatus = 'negociacao';
        propertyLifecycleStatus = 'AVAILABLE';
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SET commission_data = CAST(? AS JSON)')) {
        if (contractState) {
          contractState.commission_data = JSON.parse(String(params[0] ?? '{}'));
        }
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SET commission_data = NULL')) {
        if (contractState) {
          contractState.commission_data = null;
        }
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('INSERT INTO negotiation_documents')) {
        const nextId = 9999;
        documentsState.push({
          id: nextId,
          negotiation_id: String(params[0]),
          type: String(params[1]),
          document_type: String(params[2]),
          metadata_json: String(params[3]),
        });
        return [{ insertId: nextId }];
      }

      if (sql.includes('DELETE FROM negotiation_documents')) {
        if (sql.includes('WHERE id = ?')) {
          const targetId = Number(params[0]);
          documentsState = documentsState.filter((item) => item.id !== targetId);
        } else {
          const negotiationId = String(params[0]);
          const contractId = String(params[1]);
          documentsState = documentsState.filter((item) => {
            if (item.negotiation_id !== negotiationId) return true;
            const metadata = JSON.parse(item.metadata_json);
            const linkedContractId = String(metadata.contractId ?? '').trim();
            return linkedContractId && linkedContractId !== contractId;
          });
        }
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('DELETE FROM contracts')) {
        contractState = null;
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SET updated_at = CURRENT_TIMESTAMP')) {
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });
  });

  it('restarts a finalized contract to AWAITING_DOCS and removes linked documents', async () => {
    const response = await request(app).put('/admin/contracts/contract-final-1/reopen').send({});

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('AWAITING_DOCS');
    expect(negotiationStatus).toBe('IN_NEGOTIATION');
    expect(propertyStatus).toBe('negociacao');
    expect(propertyLifecycleStatus).toBe('AVAILABLE');
    expect(documentsState.map((item) => item.id)).toEqual([9003]);
    expect(deleteCloudinaryAssetMock).toHaveBeenCalledTimes(2);
    expect(response.body.message).toContain('documentos vinculados foram removidos');
  });

  it('updates commission_data for a finalized contract', async () => {
    const response = await request(app)
      .put('/admin/contracts/contract-final-1/commission-data')
      .send({
        commissionData: {
          valorVenda: 10000,
          comissaoCaptador: 4000,
          comissaoVendedor: 3000,
          taxaPlataforma: 3000,
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.contract.commissionData).toEqual({
      valorVenda: 10000,
      comissaoCaptador: 4000,
      comissaoVendedor: 3000,
      taxaPlataforma: 3000,
    });
  });

  it('deletes commission_data for a finalized contract', async () => {
    const response = await request(app).delete('/admin/contracts/contract-final-1/commission-data');

    expect(response.status).toBe(200);
    expect(contractState?.commission_data).toBeNull();
  });

  it('uploads and deletes finalized contract documents', async () => {
    const uploadResponse = await request(app)
      .post('/admin/contracts/contract-final-1/finalized-docs')
      .field('documentType', 'outro')
      .attach('file', Buffer.from('%PDF-1.4 extra doc'), 'extra.pdf');

    expect(uploadResponse.status).toBe(201);
    expect(uploadResponse.body.document.contractId).toBe('contract-final-1');
    expect(documentsState.some((item) => item.id === 9999)).toBe(true);

    const deleteResponse = await request(app).delete(
      '/admin/contracts/contract-final-1/finalized-docs/9999'
    );

    expect(deleteResponse.status).toBe(200);
    expect(documentsState.some((item) => item.id === 9999)).toBe(false);
  });

  it('deletes finalized contract and only linked or legacy docs from the same negotiation', async () => {
    const response = await request(app).delete('/admin/contracts/contract-final-1');

    expect(response.status).toBe(200);
    expect(contractState).toBeNull();
    expect(documentsState.map((item) => item.id)).toEqual([9003]);
    expect(deleteCloudinaryAssetMock).toHaveBeenCalledTimes(2);
  });
});
