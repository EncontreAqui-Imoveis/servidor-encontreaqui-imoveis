import { describe, expect, it, vi } from 'vitest';

const storeNegotiationDocumentToR2Mock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/negotiationDocumentStorageService', () => ({
  parseNegotiationDocumentMetadata: (value: unknown) =>
    value && typeof value === 'object' ? value : {},
  readNegotiationDocumentObject: vi.fn(),
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
});
