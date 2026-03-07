import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('./authPersistenceService', () => ({
  authDb: {
    query: queryMock,
  },
}));

import {
  confirmPasswordReset,
  hashEmailChallengeValue,
  issueEmailCodeChallenge,
  verifyEmailCode,
  verifyPasswordResetCode,
} from './emailCodeChallengeService';

describe('emailCodeChallengeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues a 6-digit challenge with 60s cooldown on first send', async () => {
    queryMock.mockResolvedValueOnce([[]]).mockResolvedValueOnce([{ insertId: 1 }]);

    const result = await issueEmailCodeChallenge({
      email: 'user@test.com',
      purpose: 'verify_email',
    });

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.cooldownSec).toBe(60);
      expect(result.dailyRemaining).toBe(4);
    }
  });

  it('locks verify_email challenge after max invalid attempts', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 10,
            email: 'user@test.com',
            purpose: 'verify_email',
            code_hash: 'wrong',
            failed_attempts: 4,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
            status: 'sent',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await verifyEmailCode({
      email: 'user@test.com',
      code: '123456',
    });

    expect(result.status).toBe('locked');
  });

  it('issues reset session token when password reset code is valid', async () => {
    const code = '123456';
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 20,
            email: 'user@test.com',
            purpose: 'password_reset',
            code_hash: hashEmailChallengeValue(code),
            failed_attempts: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 10 * 60 * 1000),
            status: 'sent',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await verifyPasswordResetCode({
      email: 'user@test.com',
      code,
    });

    expect(result.status).toBe('verified');
    if (result.status === 'verified') {
      expect(result.resetSessionToken).toBeTruthy();
    }
  });

  it('consumes reset session and updates password hash', async () => {
    const token = 'reset-token';
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 30,
            email: 'user@test.com',
            purpose: 'password_reset',
            session_token_hash: hashEmailChallengeValue(token),
            session_expires_at: new Date(Date.now() + 10 * 60 * 1000),
            status: 'verified',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await confirmPasswordReset({
      email: 'user@test.com',
      resetSessionToken: token,
      passwordHash: 'hashed-password',
    });

    expect(result.status).toBe('consumed');
  });
});
