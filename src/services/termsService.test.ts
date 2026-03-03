import { describe, expect, it, vi } from 'vitest';

import {
  getCurrentBrokerTerms,
  recordBrokerTermsAcceptance,
} from './termsService';

describe('termsService', () => {
  it('returns the latest active broker terms from the query result', async () => {
    const executor = {
      query: vi.fn().mockResolvedValue([
        [
          {
            id: 9,
            version: '2026.03',
            active: 1,
          },
        ],
      ]),
    };

    const terms = await getCurrentBrokerTerms(executor);

    expect(executor.query).toHaveBeenCalledWith(
      'SELECT * FROM broker_terms WHERE active = TRUE ORDER BY created_at DESC LIMIT 1'
    );
    expect(terms).toEqual([
      {
        id: 9,
        version: '2026.03',
        active: 1,
      },
    ]);
  });

  it('records broker acceptance with parameterized values', async () => {
    const executor = {
      query: vi.fn().mockResolvedValue([{}]),
    };

    await recordBrokerTermsAcceptance(12, 4, executor);

    expect(executor.query).toHaveBeenCalledWith(
      'INSERT INTO broker_acceptances (broker_id, terms_id) VALUES (?, ?)',
      [12, 4]
    );
  });
});
