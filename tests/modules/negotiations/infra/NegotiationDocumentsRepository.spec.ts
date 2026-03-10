import { describe, expect, it, vi } from 'vitest';

const { readNegotiationDocumentObjectMock } = vi.hoisted(() => ({
  readNegotiationDocumentObjectMock: vi.fn(),
}));

vi.mock('../../../../src/services/negotiationDocumentStorageService', () => ({
  parseNegotiationDocumentMetadata: (value: unknown) =>
    value && typeof value === 'object' ? value : {},
  readNegotiationDocumentObject: readNegotiationDocumentObjectMock,
  storeNegotiationDocumentToR2: vi.fn(),
}));

import { NegotiationDocumentsRepository } from '../../../../src/modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../../../../src/modules/negotiations/infra/NegotiationRepository';

describe('NegotiationDocumentsRepository.findById', () => {
  it('should return the document object with a Buffer when found', async () => {
    const expectedBuffer = Buffer.from('fake-pdf');
    readNegotiationDocumentObjectMock.mockResolvedValue(expectedBuffer);
    const execute = vi.fn().mockResolvedValue([
      [
        {
          negotiation_id: 'neg-1',
          type: 'proposal',
          document_type: null,
          metadata_json: {},
          storage_provider: 'R2',
          storage_bucket: 'bucket',
          storage_key: 'key',
          storage_content_type: 'application/pdf',
          storage_size_bytes: expectedBuffer.length,
          storage_etag: 'etag',
        },
      ],
      {},
    ]);

    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.findById(123);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      [
      123,
      ]
    );
    expect(result).toEqual({
      negotiationId: 'neg-1',
      fileContent: expectedBuffer,
      type: 'proposal',
      documentType: null,
      metadataJson: {},
    });
    expect(Buffer.isBuffer(result?.fileContent)).toBe(true);
  });

  it('should return null when the ID does not exist', async () => {
    const execute = vi.fn().mockResolvedValue([[], {}]);

    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.findById(999);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT'),
      [
      999,
      ]
    );
    expect(result).toBeNull();
  });
});
