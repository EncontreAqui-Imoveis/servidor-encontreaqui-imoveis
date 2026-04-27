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

  it('alinha colunas/valores no insert para fluxo sem draft', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 101 }]);

    const result = await issueEmailCodeChallenge({
      email: 'legacy@example.com',
      purpose: 'verify_email',
      userId: 1,
    });

    expect(result.allowed).toBe(true);

    const insertCall = queryMock.mock.calls[1];
    const sql = String(insertCall?.[0] ?? '');
    const values = insertCall?.[1] as unknown[];
    const match = sql.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/s);
    expect(match).not.toBeNull();
    const columns = match![1].split(',').map((item) => item.trim()).filter(Boolean);
    const valueTokens = match![2].split(',').map((item) => item.trim()).filter(Boolean);
    expect(columns).toHaveLength(valueTokens.length);
    expect(columns).toEqual([
      'user_id',
      'draft_id',
      'draft_token_hash',
      'draft_step',
      'email',
      'purpose',
      'code_hash',
      'send_attempt_number',
      'failed_attempts',
      'max_attempts',
      'cooldown_seconds',
      'expires_at',
      'sent_at',
      'delivery_provider',
      'status',
    ]);
    expect(valueTokens).toHaveLength(columns.length);
    expect(values).toHaveLength(valueTokens.filter((token) => token === '?').length);
    expect(values[1]).toBeNull();
    expect(values[2]).toBeNull();
    expect(values[3]).toBeNull();
  });

  it('alinha colunas/valores no insert para fluxo com draft e permite resend', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 55, sent_at: new Date(Date.now() - 120 * 1000) }]])
      .mockResolvedValueOnce([{ insertId: 202 }]);

    const issue = await issueEmailCodeChallenge({
      email: 'draft@example.com',
      purpose: 'verify_email',
      draftId: 123,
      draftTokenHash: 'token-hash',
      draftStep: 2,
    });
    expect(issue.allowed).toBe(true);
    if (issue.allowed) {
      expect(issue.attemptNumber).toBe(2);
      expect(issue.requestId).toBe(202);
    }

    const insertCall = queryMock.mock.calls[1];
    const sql = String(insertCall?.[0] ?? '');
    const values = insertCall?.[1] as unknown[];
    const match = sql.match(/\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/s);
    expect(match).not.toBeNull();
    const columns = match![1].split(',').map((item) => item.trim()).filter(Boolean);
    const valueTokens = match![2].split(',').map((item) => item.trim()).filter(Boolean);
    expect(columns).toHaveLength(valueTokens.length);
    expect(columns[1]).toBe('draft_id');
    expect(columns[2]).toBe('draft_token_hash');
    expect(columns[3]).toBe('draft_step');
    expect(values).toHaveLength(15);
    expect(values[1]).toBe(123);
    expect(values[2]).toBe('token-hash');
    expect(values[3]).toBe(2);
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
