import { describe, expect, it } from 'vitest';

import {
  calculateHistogramQuantile,
  getSreRetentionDays,
  getSreSnapshotIntervalMs,
  isSreStatsEnabled,
} from './sreStatsService';

describe('isSreStatsEnabled', () => {
  it.each([undefined, '', '0', 'false', 'no', 'unexpected'])('defaults to disabled for %j', (value) => {
    expect(isSreStatsEnabled(value)).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'TRUE'])('requires an explicit enable value: %s', (value) => {
    expect(isSreStatsEnabled(value)).toBe(true);
  });
});

describe('SRE configuration bounds', () => {
  it('uses a conservative five-minute snapshot interval by default', () => {
    expect(getSreSnapshotIntervalMs(undefined)).toBe(300000);
  });

  it('clamps snapshot intervals to avoid expensive polling', () => {
    expect(getSreSnapshotIntervalMs('1')).toBe(60000);
    expect(getSreSnapshotIntervalMs('999999999')).toBe(3600000);
  });

  it('clamps metric retention to an explicit short operational window', () => {
    expect(getSreRetentionDays('0')).toBe(1);
    expect(getSreRetentionDays('999')).toBe(90);
    expect(getSreRetentionDays('30')).toBe(30);
  });
});

describe('calculateHistogramQuantile', () => {
  it('calculates p99 from cumulative prometheus histogram buckets', () => {
    const seconds = calculateHistogramQuantile(0.99, [
      { upperBound: 0.1, count: 50 },
      { upperBound: 0.5, count: 95 },
      { upperBound: 1, count: 100 },
    ]);

    expect(seconds).toBeCloseTo(0.9, 5);
  });

  it('returns zero when the process has no completed requests yet', () => {
    expect(calculateHistogramQuantile(0.99, [])).toBe(0);
  });
});
