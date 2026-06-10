import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../../src/modules/negotiations/domain/errors/ValidationError';
import { normalizeCommissionRuleRow } from '../../../src/modules/negotiations/infra/commissionRuleHelpers';

describe('commissionRuleHelpers', () => {
  it('falls back to the sum when total_percentage is missing', () => {
    expect(
      normalizeCommissionRuleRow({
        capturing_percentage: '2',
        selling_percentage: 3,
        total_percentage: null,
      })
    ).toEqual({
      capturingPercentage: 2,
      sellingPercentage: 3,
      totalPercentage: 5,
    });
  });

  it('rejects invalid commission rule rows', () => {
    expect(() =>
      normalizeCommissionRuleRow({
        capturing_percentage: 'abc',
        selling_percentage: 3,
        total_percentage: 5,
      })
    ).toThrow(ValidationError);
  });

  it('rejects missing rows', () => {
    expect(() => normalizeCommissionRuleRow(null)).toThrow('Active commission rule not found.');
  });
});
