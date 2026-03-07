import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  latestChallenge: null as any,
  nextInsertId: 1,
};

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    query: queryMock,
  },
}));

import {
  issueEmailCodeChallenge,
  verifyEmailCode,
} from '../../src/services/emailCodeChallengeService';

describe('local stress: email code challenges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.latestChallenge = null;
    state.nextInsertId = 1;

    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM email_code_challenges') && sql.includes('INTERVAL 24 HOUR')) {
        return [state.latestChallenge ? [state.latestChallenge] : []];
      }

      if (sql.includes('INSERT INTO email_code_challenges')) {
        const [
          userId,
          email,
          purpose,
          codeHash,
          sendAttemptNumber,
          maxAttempts,
          cooldownSeconds,
          expiresAt,
          sentAt,
          deliveryProvider,
        ] = params;
        state.latestChallenge = {
          id: state.nextInsertId++,
          user_id: userId,
          email,
          purpose,
          code_hash: codeHash,
          send_attempt_number: sendAttemptNumber,
          failed_attempts: 0,
          max_attempts: maxAttempts,
          cooldown_seconds: cooldownSeconds,
          expires_at: expiresAt,
          sent_at: sentAt,
          delivery_provider: deliveryProvider,
          status: 'sent',
        };
        return [{ insertId: state.latestChallenge.id }];
      }

      if (sql.includes('SELECT *') && sql.includes("purpose = 'verify_email'")) {
        return [state.latestChallenge ? [state.latestChallenge] : []];
      }

      if (sql.includes('SET failed_attempts = ?')) {
        const [failedAttempts, status] = params;
        state.latestChallenge.failed_attempts = failedAttempts;
        state.latestChallenge.status = status;
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('SET status = \'verified\'')) {
        state.latestChallenge.status = 'verified';
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE users')) {
        return [{ affectedRows: 1 }];
      }

      throw new Error(`Unhandled query in local stress test: ${sql}`);
    });
  });

  it('locks challenge after repeated invalid attempts', async () => {
    const issue = await issueEmailCodeChallenge({
      email: 'stress@test.com',
      purpose: 'verify_email',
    });

    expect(issue.allowed).toBe(true);

    for (let i = 0; i < 4; i++) {
      const result = await verifyEmailCode({
        email: 'stress@test.com',
        code: '000000',
      });
      expect(result.status).toBe('invalid');
    }

    const locked = await verifyEmailCode({
      email: 'stress@test.com',
      code: '000000',
    });
    expect(locked.status).toBe('locked');
  });
});
