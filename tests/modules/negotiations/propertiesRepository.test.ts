import { PropertiesRepository } from '../../../src/modules/negotiations/infra/PropertiesRepository';

describe('PropertiesRepository.markAvailable', () => {
  it('logs warning when no rows are affected', async () => {
    const execute = jest.fn().mockResolvedValue({ affectedRows: 0 });
    const logger = { warn: jest.fn() };
    const repo = new PropertiesRepository({ execute } as any, logger);

    await repo.markAvailable({ id: 10, trx: { execute } as any });

    expect(logger.warn).toHaveBeenCalledWith(
      'PropertiesRepository.markAvailable skipped due to sold/rented status.',
      { propertyId: 10 }
    );
  });

  it('does not log warning when update succeeds', async () => {
    const execute = jest.fn().mockResolvedValue({ affectedRows: 1 });
    const logger = { warn: jest.fn() };
    const repo = new PropertiesRepository({ execute } as any, logger);

    await repo.markAvailable({ id: 11, trx: { execute } as any });

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
