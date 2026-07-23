import { describe, expect, it } from 'vitest';

import {
  canUsePropertyMarketStage,
  normalizePropertyMarketStage,
} from '../../src/utils/propertyMarketStage';

describe('property market stage', () => {
  it('normalizes omitted and Portuguese launch values safely', () => {
    expect(normalizePropertyMarketStage(undefined)).toBe('STANDARD');
    expect(normalizePropertyMarketStage('lançamento')).toBe('LAUNCH');
    expect(normalizePropertyMarketStage('LAUNCH')).toBe('LAUNCH');
  });

  it('allows launches only when the property purpose includes sale', () => {
    expect(canUsePropertyMarketStage('LAUNCH', 'Venda')).toBe(true);
    expect(canUsePropertyMarketStage('LAUNCH', 'Venda e Aluguel')).toBe(true);
    expect(canUsePropertyMarketStage('LAUNCH', 'Aluguel')).toBe(false);
    expect(canUsePropertyMarketStage('STANDARD', 'Aluguel')).toBe(true);
  });

  it('rejects unknown market stages instead of widening visibility', () => {
    expect(normalizePropertyMarketStage('pre_launch')).toBeNull();
  });
});
