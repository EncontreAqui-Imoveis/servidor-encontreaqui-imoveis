import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('./authPersistenceService', () => ({
  authDb: {
    query: queryMock,
  },
}));

import { issueEmailVerificationRequest } from './emailVerificationService';

describe('emailVerificationService.issueEmailVerificationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses 60s as next cooldown on first send', async () => {
    queryMock.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 1 }]);

    const result = await issueEmailVerificationRequest({ email: 'user@test.com' });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.resendType).toBe('initial');
      expect(result.cooldownSec).toBe(60);
      expect(result.dailyRemaining).toBe(4);
    }
  });

  it('uses 90s as next cooldown on second send', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 1,
            sent_at: new Date(Date.now() - 61_000),
            expires_at: new Date(Date.now() + 10_000),
            status: 'sent',
          },
        ],
      ])
      .mockResolvedValueOnce([{ insertId: 2 }]);

    const result = await issueEmailVerificationRequest({ email: 'user@test.com' });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.resendType).toBe('resend');
      expect(result.cooldownSec).toBe(90);
      expect(result.dailyRemaining).toBe(3);
    }
  });

  it('uses 120s as next cooldown on third+ send', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 2,
            sent_at: new Date(Date.now() - 91_000),
            expires_at: new Date(Date.now() + 10_000),
            status: 'sent',
          },
          {
            id: 1,
            sent_at: new Date(Date.now() - 300_000),
            expires_at: new Date(Date.now() + 10_000),
            status: 'sent',
          },
        ],
      ])
      .mockResolvedValueOnce([{ insertId: 3 }]);

    const result = await issueEmailVerificationRequest({ email: 'user@test.com' });
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.cooldownSec).toBe(120);
      expect(result.dailyRemaining).toBe(2);
    }
  });

  it('blocks sends above daily limit (5/24h)', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 5,
          sent_at: new Date(Date.now() - 5_000),
          expires_at: new Date(Date.now() + 10_000),
          status: 'sent',
        },
        {
          id: 4,
          sent_at: new Date(Date.now() - 10_000),
          expires_at: new Date(Date.now() + 10_000),
          status: 'sent',
        },
        {
          id: 3,
          sent_at: new Date(Date.now() - 20_000),
          expires_at: new Date(Date.now() + 10_000),
          status: 'sent',
        },
        {
          id: 2,
          sent_at: new Date(Date.now() - 30_000),
          expires_at: new Date(Date.now() + 10_000),
          status: 'sent',
        },
        {
          id: 1,
          sent_at: new Date(Date.now() - 40_000),
          expires_at: new Date(Date.now() + 10_000),
          status: 'sent',
        },
      ],
    ]);

    const result = await issueEmailVerificationRequest({ email: 'user@test.com' });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.code).toBe('EMAIL_RESEND_RATE_LIMITED');
      expect(result.dailyRemaining).toBe(0);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });
});
