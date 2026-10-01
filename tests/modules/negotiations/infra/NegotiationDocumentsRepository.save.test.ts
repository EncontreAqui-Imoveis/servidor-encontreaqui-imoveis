import { describe, expect, it, vi } from 'vitest';

const {
  storeNegotiationDocumentToR2Mock,
  readNegotiationDocumentObjectMock,
} = vi.hoisted(() => ({
  storeNegotiationDocumentToR2Mock: vi.fn(),
  readNegotiationDocumentObjectMock: vi.fn(),
}));

vi.mock('../../../../src/services/negotiationDocumentStorageService', () => ({
  parseNegotiationDocumentMetadata: (value: unknown) =>
    value && typeof value === 'object' ? value : {},
  readNegotiationDocumentObject: readNegotiationDocumentObjectMock,
  storeNegotiationDocumentToR2: storeNegotiationDocumentToR2Mock,
}));

import { NegotiationDocumentsRepository } from '../../../../src/modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../../../../src/modules/negotiations/infra/NegotiationRepository';

describe('NegotiationDocumentsRepository.save*', () => {
  it('saves proposal documents with the expected defaults', async () => {
    storeNegotiationDocumentToR2Mock.mockResolvedValueOnce(11);
    const execute = vi.fn();
    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.saveProposal('neg-1', Buffer.from('pdf'));

    expect(result).toBe(11);
    expect(storeNegotiationDocumentToR2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        negotiationId: 'neg-1',
        type: 'proposal',
        documentType: 'contrato_minuta',
        metadataJson: {
          originalFileName: 'proposta.pdf',
          generated: true,
        },
      })
    );
  });

  it('saves signed proposal documents with the expected defaults', async () => {
    storeNegotiationDocumentToR2Mock.mockResolvedValueOnce(22);
    const execute = vi.fn();
    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.saveSignedProposal('neg-2', Buffer.from('pdf'));

    expect(result).toBe(22);
    expect(storeNegotiationDocumentToR2Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        negotiationId: 'neg-2',
        type: 'other',
        documentType: 'contrato_assinado',
        metadataJson: {
          originalFileName: 'proposta_assinada.pdf',
        },
      })
    );
  });

  it('finds signed proposals only among their dedicated document records', async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        id: 23,
        negotiation_id: 'neg-2',
        type: 'other',
        document_type: 'contrato_assinado',
        metadata_json: {},
        storage_provider: 'R2',
        storage_bucket: 'documents',
        storage_key: 'proposal.pdf',
        storage_content_type: 'application/pdf',
        storage_size_bytes: 12,
        storage_etag: null,
      },
    ]);
    readNegotiationDocumentObjectMock.mockResolvedValueOnce(
      Buffer.from('%PDF-signed-proposal%')
    );
    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.findLatestSignedProposal('neg-2');

    expect(result).toEqual({
      id: 23,
      fileContent: Buffer.from('%PDF-signed-proposal%'),
      type: 'other',
    });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("AND type = 'other'\n        AND document_type = 'contrato_assinado'"),
      ['neg-2']
    );
  });
});
