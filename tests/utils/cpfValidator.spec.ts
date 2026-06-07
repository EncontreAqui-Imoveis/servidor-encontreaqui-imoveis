import { describe, expect, it } from 'vitest';

import { isValidCpf, normalizeCpfDigits } from '../../src/utils/cpfValidator';

describe('cpfValidator', () => {
  it('normalizes digits and strips formatting', () => {
    expect(normalizeCpfDigits('529.982.247-25')).toBe('52998224725');
  });

  it('accepts a valid cpf by check digits', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224725')).toBe(true);
  });

  it('rejects repeated digits and invalid check digits', () => {
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('12345678900')).toBe(false);
  });
});
