import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

const { enqueueNegotiationDocumentDeletionMock, storeNegotiationDocumentToR2Mock } = vi.hoisted(() => ({
  storeNegotiationDocumentToR2Mock: vi.fn(),
  enqueueNegotiationDocumentDeletionMock: vi.fn(),
}));

vi.mock('./negotiationDocumentStorageService', () => ({
  isInvalidNegotiationDocumentContentError: () => false,
  storeNegotiationDocumentToR2: storeNegotiationDocumentToR2Mock,
}));

vi.mock('./negotiationDocumentDeletionService', () => ({
  enqueueNegotiationDocumentDeletion: enqueueNegotiationDocumentDeletionMock,
}));

import { uploadContractDocument } from './contractDocumentMutationService';
import type { ContractRow } from '../controllers/ContractController';

function buildRequest() {
  return {
    userId: 1,
    userRole: 'admin',
  } as never;
}

function pendingReplacementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 88,
    type: 'contract',
    document_type: 'doc_identidade',
    metadata_json: {
      contractId: 'contract-1',
      owner_side: 'seller',
      documentCategory: 'identidade',
      categoryStatus: 'PENDING',
    },
    storage_provider: 'r2',
    storage_bucket: 'documents',
    storage_key: 'contracts/old.pdf',
    storage_content_type: 'application/pdf',
    storage_size_bytes: 100,
    storage_etag: 'etag',
    created_at: new Date(),
    ...overrides,
  };
}

const file = {
  buffer: Buffer.alloc(1024, '%PDF-1.4'),
  mimetype: 'application/pdf',
  originalname: 'identidade.pdf',
  size: 1024,
} as Express.Multer.File;

describe('uploadContractDocument', () => {
  it.each(['APPROVED', 'APPROVED_WITH_RES'])(
    'blocks a new document for an already approved side (%s)',
    async (sellerStatus) => {
      const contract = {
        id: 'contract-1',
        negotiation_id: 'neg-1',
        status: 'AWAITING_DOCS',
        seller_approval_status: sellerStatus,
        buyer_approval_status: 'PENDING',
      } as ContractRow;
      const tx = { query: vi.fn() } as unknown as PoolConnection;

      await expect(uploadContractDocument(tx, {
        req: buildRequest(),
        contract,
        contractId: 'contract-1',
        body: { side: 'seller', documentCategory: 'identidade', documentType: 'doc_identidade' },
        uploadedFile: file,
      })).rejects.toMatchObject({
        statusCode: 409,
        body: {
          code: 'SIDE_ALREADY_APPROVED',
        },
        message: 'Este lado já foi aprovado. Reinicie a análise antes de fazer alterações.',
      });
      expect(tx.query).not.toHaveBeenCalled();
    }
  );

  it('allows a rejected side to upload a new pending version', async () => {
    const contract = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
      status: 'AWAITING_DOCS',
      seller_approval_status: 'REJECTED',
      buyer_approval_status: 'PENDING',
      workflow_metadata: {},
    } as ContractRow;
    const tx = {
      query: vi.fn().mockResolvedValue([[]]),
    } as unknown as PoolConnection;
    storeNegotiationDocumentToR2Mock.mockResolvedValue(101);

    const result = await uploadContractDocument(tx, {
      req: buildRequest(),
      contract,
      contractId: 'contract-1',
      body: {
        side: 'seller',
        documentCategory: 'identidade',
        documentType: 'doc_identidade',
      },
      uploadedFile: file,
    });

    expect(result.document).toMatchObject({
      id: 101,
      side: 'seller',
      documentCategory: 'identidade',
    });
    expect(storeNegotiationDocumentToR2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({
          owner_side: 'seller',
          documentCategory: 'identidade',
          categoryStatus: 'PENDING',
        }),
      })
    );
  });

  it('replaces only the current pending document in the same slot', async () => {
    const contract = {
      id: 'contract-1', negotiation_id: 'neg-1', status: 'AWAITING_DOCS',
      seller_approval_status: 'PENDING', buyer_approval_status: 'PENDING', workflow_metadata: {},
    } as ContractRow;
    const tx = { query: vi.fn().mockResolvedValue([[]]) } as unknown as PoolConnection;
    (tx.query as any).mockResolvedValueOnce([[pendingReplacementRow()]]);
    storeNegotiationDocumentToR2Mock.mockResolvedValue(101);
    enqueueNegotiationDocumentDeletionMock.mockResolvedValue(1);

    const result = await uploadContractDocument(tx, {
      req: buildRequest(), contract, contractId: 'contract-1',
      body: { side: 'seller', documentCategory: 'identidade', documentType: 'doc_identidade', replaceDocumentId: 88 },
      uploadedFile: file,
    });

    expect(result.document.id).toBe(101);
    expect(result.replacedDocument?.id).toBe(88);
    expect(tx.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM negotiation_documents'),
      [88, 'neg-1']
    );
  });

  it.each([
    ['another contract', pendingReplacementRow({ metadata_json: { contractId: 'contract-2', owner_side: 'seller', documentCategory: 'identidade', categoryStatus: 'PENDING' } })],
    ['another side', pendingReplacementRow({ metadata_json: { contractId: 'contract-1', owner_side: 'buyer', documentCategory: 'identidade', categoryStatus: 'PENDING' } })],
    ['already approved document', pendingReplacementRow({ metadata_json: { contractId: 'contract-1', owner_side: 'seller', documentCategory: 'identidade', categoryStatus: 'APPROVED' } })],
  ])('rejects replacement for %s', async (_caseName, replacement) => {
    const contract = {
      id: 'contract-1', negotiation_id: 'neg-1', status: 'AWAITING_DOCS',
      seller_approval_status: 'PENDING', buyer_approval_status: 'PENDING', workflow_metadata: {},
    } as ContractRow;
    const tx = { query: vi.fn().mockResolvedValue([[]]) } as unknown as PoolConnection;
    (tx.query as any).mockResolvedValueOnce([[replacement]]);
    await expect(uploadContractDocument(tx, {
      req: buildRequest(), contract, contractId: 'contract-1',
      body: { side: 'seller', documentCategory: 'identidade', documentType: 'doc_identidade', replaceDocumentId: 88 }, uploadedFile: file,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects a replacement while the side is rejected', async () => {
    const contract = {
      id: 'contract-1', negotiation_id: 'neg-1', status: 'AWAITING_DOCS',
      seller_approval_status: 'REJECTED', buyer_approval_status: 'PENDING', workflow_metadata: {},
    } as ContractRow;
    const tx = { query: vi.fn().mockResolvedValue([[]]) } as unknown as PoolConnection;
    (tx.query as any).mockResolvedValueOnce([[pendingReplacementRow()]]);
    await expect(uploadContractDocument(tx, {
      req: buildRequest(), contract, contractId: 'contract-1',
      body: { side: 'seller', documentCategory: 'identidade', documentType: 'doc_identidade', replaceDocumentId: 88 }, uploadedFile: file,
    })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows a document operator only with an explicit pending replacement', async () => {
    const contract = {
      id: 'contract-1', negotiation_id: 'neg-1', status: 'AWAITING_DOCS',
      seller_approval_status: 'PENDING', buyer_approval_status: 'PENDING', workflow_metadata: {},
    } as ContractRow;
    const tx = { query: vi.fn().mockResolvedValue([[]]) } as unknown as PoolConnection;
    (tx.query as any).mockResolvedValueOnce([[pendingReplacementRow()]]);
    storeNegotiationDocumentToR2Mock.mockResolvedValue(101);
    enqueueNegotiationDocumentDeletionMock.mockResolvedValue(1);
    const request = {
      userId: 1,
      userRole: 'admin',
      adminValidated: true,
      adminRole: 'document_operator',
    } as never;
    await expect(uploadContractDocument(tx, {
      req: request, contract, contractId: 'contract-1',
      body: { side: 'seller', documentCategory: 'identidade', documentType: 'doc_identidade', replaceDocumentId: 88 }, uploadedFile: file,
    })).resolves.toMatchObject({ document: { id: 101 } });
    await expect(uploadContractDocument(tx, {
      req: request, contract, contractId: 'contract-1',
      body: { side: 'seller', documentCategory: 'identidade', documentType: 'doc_identidade' }, uploadedFile: file,
    })).rejects.toMatchObject({ statusCode: 403, body: { code: 'ADMIN_DOCUMENT_CREATE_FORBIDDEN' } });
  });
});
