import { describe, expect, it } from 'vitest';
import {
  SUPPORT_REQUEST_COOLDOWN_MS,
  evaluateSupportRequestCooldown,
} from './supportRequestService';

describe('evaluateSupportRequestCooldown', () => {
  it('allows when no previous request exists', () => {
    const result = evaluateSupportRequestCooldown(null, new Date('2026-01-01T12:00:00Z'));
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });

  it('blocks when last request is inside cooldown', () => {
    const now = new Date('2026-01-01T12:00:00Z');
    const lastRequest = new Date(now.getTime() - 60 * 60 * 1000);
    const result = evaluateSupportRequestCooldown(lastRequest, now);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('allows when cooldown has expired', () => {
    const now = new Date('2026-01-02T12:00:00Z');
    const lastRequest = new Date(now.getTime() - SUPPORT_REQUEST_COOLDOWN_MS - 1000);
    const result = evaluateSupportRequestCooldown(lastRequest, now);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
  });
});
