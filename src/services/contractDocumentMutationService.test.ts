import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import { uploadContractDocument } from './contractDocumentMutationService';
import type { ContractRow } from '../controllers/ContractController';

function buildRequest() {
  return {
    userId: 1,
    userRole: 'admin',
  } as never;
}

const file = {
  buffer: Buffer.from('%PDF-1.4'),
  mimetype: 'application/pdf',
  originalname: 'identidade.pdf',
  size: 8,
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
});
