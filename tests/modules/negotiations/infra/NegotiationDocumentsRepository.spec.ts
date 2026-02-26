import { describe, expect, it, vi } from 'vitest';

import { NegotiationDocumentsRepository } from '../../../../src/modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../../../../src/modules/negotiations/infra/NegotiationRepository';

describe('NegotiationDocumentsRepository.findById', () => {
  it('should return the document object with a Buffer when found', async () => {
    const expectedBuffer = Buffer.from('fake-pdf');
    const execute = vi.fn().mockResolvedValue([
      [
        {
          negotiation_id: 'neg-1',
          file_content: expectedBuffer,
          type: 'proposal',
          document_type: null,
          metadata_json: null,
        },
      ],
      {},
    ]);

    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.findById(123);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT negotiation_id, file_content, type'),
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
      expect.stringContaining('SELECT negotiation_id, file_content, type'),
      [
      999,
      ]
    );
    expect(result).toBeNull();
  });
});
