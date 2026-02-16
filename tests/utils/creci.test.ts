import { describe, expect, it } from 'vitest';
import { CRECI_REGEX, hasValidCreci, normalizeCreci } from '../../src/utils/creci';

describe('CRECI validation', () => {
  it('normalizes CRECI by trimming, removing inner spaces and uppercasing', () => {
    expect(normalizeCreci(' 12345 - f ')).toBe('12345-F');
  });

  it('accepts CRECI formats with numbers and optional letter suffix', () => {
    expect(hasValidCreci('1234')).toBe(true);
    expect(hasValidCreci('123456')).toBe(true);
    expect(hasValidCreci('12345-F')).toBe(true);
    expect(hasValidCreci('123456j')).toBe(true);
    expect(CRECI_REGEX.test('123456-J')).toBe(true);
  });

  it('rejects invalid CRECI formats', () => {
    expect(hasValidCreci('123')).toBe(false);
    expect(hasValidCreci('1234567')).toBe(false);
    expect(hasValidCreci('12A34')).toBe(false);
    expect(hasValidCreci('12-345')).toBe(false);
    expect(hasValidCreci('ABCD')).toBe(false);
  });
});
