import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveContractStatusMock,
  storeNegotiationDocumentToR2Mock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    query: vi.fn(),
  };

  return {
    resolveContractStatusMock: vi.fn(),
    storeNegotiationDocumentToR2Mock: vi.fn(),
    txMock: tx,
  };
});

vi.mock('../../src/controllers/ContractController', () => ({
  __esModule: true,
  resolveContractStatus: resolveContractStatusMock,
}));

vi.mock('../../src/services/negotiationDocumentStorageService', () => ({
  __esModule: true,
  storeNegotiationDocumentToR2: storeNegotiationDocumentToR2Mock,
}));

import {
  deleteFinalizedContractDocument,
  isContractFinalizedDocumentMutationError,
  uploadFinalizedContractDocument,
} from '../../src/services/contractFinalizedDocumentMutationService';

describe('contractFinalizedDocumentMutationService', () => {
  const contract = {
    id: 'contract-final-1',
    negotiation_id: 'neg-final-1',
    property_id: 101,
    status: 'FINALIZED',
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveContractStatusMock.mockImplementation((status: string) => status);
    storeNegotiationDocumentToR2Mock.mockResolvedValue(9999);
  });

  it('uploads a finalized document and returns the final payload', async () => {
    txMock.query.mockResolvedValue([{ affectedRows: 1 }]);

    const result = await uploadFinalizedContractDocument(txMock as never, {
      req: { userId: 7 } as never,
      contract,
      contractId: 'contract-final-1',
      body: {
        documentType: 'outro',
      },
      uploadedFile: {
        buffer: Buffer.from('%PDF-1.4'),
        originalname: 'extra.pdf',
      } as never,
    });

    expect(storeNegotiationDocumentToR2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        negotiationId: 'neg-final-1',
        documentType: 'outro',
      })
    );
    expect(result.document).toEqual({
      id: 9999,
      contractId: 'contract-final-1',
      documentType: 'outro',
      side: null,
      originalFileName: 'extra.pdf',
      downloadUrl: '/negotiations/neg-final-1/documents/9999/download',
    });
  });

  it('rejects uploads when the contract is not finalized', async () => {
    resolveContractStatusMock.mockReturnValue('AWAITING_DOCS');

    await expect(
      uploadFinalizedContractDocument(txMock as never, {
        req: { userId: 7 } as never,
        contract,
        contractId: 'contract-final-1',
        body: { documentType: 'outro' },
        uploadedFile: {
          buffer: Buffer.from('%PDF-1.4'),
          originalname: 'extra.pdf',
        } as never,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Somente contratos finalizados podem receber documentos nesta área.',
    });
  });

  it('deletes a finalized contract document and returns the asset row', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 9999,
            type: 'other',
            document_type: 'outro',
            metadata_json: JSON.stringify({ contractId: 'contract-final-1' }),
            storage_provider: 'R2',
            storage_bucket: 'bucket',
            storage_key: 'key-9999',
            storage_content_type: 'application/pdf',
            storage_size_bytes: 10,
            storage_etag: null,
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await deleteFinalizedContractDocument(txMock as never, {
      contract,
      contractId: 'contract-final-1',
      documentId: 9999,
    });

    expect(result.document.id).toBe(9999);
    expect(result.document.document_type).toBe('outro');
  });

  it('exposes the service error guard', () => {
    expect(isContractFinalizedDocumentMutationError(new Error('x'))).toBe(false);
  });
});
