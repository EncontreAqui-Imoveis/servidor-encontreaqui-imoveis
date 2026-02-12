import { NegotiationDocumentsRepository } from '../../../../src/modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../../../../src/modules/negotiations/infra/NegotiationRepository';

describe('NegotiationDocumentsRepository.findById', () => {
  it('should return the document object with a Buffer when found', async () => {
    const expectedBuffer = Buffer.from('fake-pdf');
    const execute = jest.fn().mockResolvedValue([
      [
        {
          file_content: expectedBuffer,
          type: 'proposal',
        },
      ],
      {},
    ]);

    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.findById(123);

    expect(execute).toHaveBeenCalledWith(expect.stringContaining('SELECT file_content, type'), [
      123,
    ]);
    expect(result).toEqual({
      fileContent: expectedBuffer,
      type: 'proposal',
    });
    expect(Buffer.isBuffer(result?.fileContent)).toBe(true);
  });

  it('should return null when the ID does not exist', async () => {
    const execute = jest.fn().mockResolvedValue([[], {}]);

    const repository = new NegotiationDocumentsRepository({
      execute,
    } as unknown as SqlExecutor);

    const result = await repository.findById(999);

    expect(execute).toHaveBeenCalledWith(expect.stringContaining('SELECT file_content, type'), [
      999,
    ]);
    expect(result).toBeNull();
  });
});
