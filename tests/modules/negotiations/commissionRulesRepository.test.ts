import { describe, expect, it, vi } from 'vitest';

import { CommissionRulesRepository } from '../../../src/modules/negotiations/infra/CommissionRulesRepository';

describe('CommissionRulesRepository', () => {
  it('returns the active rule normalized from mysql rows', async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        {
          capturing_percentage: '2',
          selling_percentage: '3',
          total_percentage: null,
        },
      ],
      undefined,
    ]);

    const repo = new CommissionRulesRepository({ execute } as any);
    await expect(repo.getActiveRule()).resolves.toEqual({
      capturingPercentage: 2,
      sellingPercentage: 3,
      totalPercentage: 5,
    });
  });

  it('throws when the active rule is missing', async () => {
    const execute = vi.fn().mockResolvedValue([[], undefined]);
    const repo = new CommissionRulesRepository({ execute } as any);

    await expect(repo.getActiveRule()).rejects.toThrow('Active commission rule not found.');
  });
});
