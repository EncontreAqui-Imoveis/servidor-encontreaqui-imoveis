import { describe, expect, it } from 'vitest';

import { buildCommissionInsertStatement } from '../../../src/modules/negotiations/infra/commissionInsertSql';

describe('commissionInsertSql', () => {
  it('builds the commission insert statement and bindings in order', () => {
    const statement = buildCommissionInsertStatement({
      negotiationId: 'neg-1',
      commissions: [
        { brokerId: 10, role: 'CAPTURING', amount: 1234.56 },
        { brokerId: 20, role: 'SELLING', amount: 789.1 },
      ],
    });

    expect(statement.sql).toContain('INSERT INTO commissions');
    expect(statement.sql).toContain('VALUES');
    expect(statement.bindings).toEqual(['neg-1', 10, 'CAPTURING', 1234.56, 'neg-1', 20, 'SELLING', 789.1]);
  });

  it('rejects invalid broker ids before querying the database', () => {
    expect(() =>
      buildCommissionInsertStatement({
        negotiationId: 'neg-1',
        commissions: [{ brokerId: Number.NaN, role: 'CAPTURING', amount: 100 }],
      })
    ).toThrow('Invalid broker id for commission insert.');
  });

  it('rejects invalid commission amounts before querying the database', () => {
    expect(() =>
      buildCommissionInsertStatement({
        negotiationId: 'neg-1',
        commissions: [{ brokerId: 10, role: 'CAPTURING', amount: Number.NaN }],
      })
    ).toThrow('Invalid commission amount for commission insert.');
  });
});
