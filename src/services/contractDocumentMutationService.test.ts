import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

const { storeNegotiationDocumentToR2Mock } = vi.hoisted(() => ({
  storeNegotiationDocumentToR2Mock: vi.fn(),
}));

vi.mock('./negotiationDocumentStorageService', () => ({
  isInvalidNegotiationDocumentContentError: () => false,
  storeNegotiationDocumentToR2: storeNegotiationDocumentToR2Mock,
}));

import { uploadContractDocument } from './contractDocumentMutationService';
import type { ContractRow } from '../controllers/ContractController';

function buildRequest() {
  return {
    userId: 1,
    userRole: 'admin',
  } as never;
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
});
