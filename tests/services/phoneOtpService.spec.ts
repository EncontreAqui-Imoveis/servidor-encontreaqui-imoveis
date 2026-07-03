import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoredOtp = {
  phone: string;
  session_token: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  cooldown_seconds: number;
  expires_at: Date;
};

const store = new Map<string, StoredOtp>();

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    query: queryMock,
  },
}));

function response<T>(rows: T): [T] {
  return [rows];
}

beforeEach(() => {
  store.clear();
  queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const normalizedSql = String(sql).trim().replace(/\s+/g, ' ');

    if (normalizedSql.startsWith('DELETE FROM auth_phone_otps WHERE expires_at <= NOW()')) {
      for (const [token, row] of store) {
        if (row.expires_at.getTime() <= Date.now()) {
          store.delete(token);
        }
      }
      return response([]);
    }

    if (normalizedSql.startsWith('DELETE FROM auth_phone_otps WHERE phone = ? AND expires_at > NOW()')) {
      const [phone] = params as [string];
      for (const [token, row] of store) {
        if (row.phone === phone) {
          store.delete(token);
        }
      }
      return response([]);
    }

    if (normalizedSql.startsWith('DELETE FROM auth_phone_otps WHERE session_token = ?')) {
      const [sessionToken] = params as [string];
      store.delete(sessionToken);
      return response([]);
    }

    if (normalizedSql.startsWith('DELETE FROM auth_phone_otps')) {
      store.clear();
      return response([]);
    }

    if (normalizedSql.startsWith('INSERT INTO auth_phone_otps')) {
      const [phone, sessionToken, codeHash, maxAttempts, cooldownSeconds, expiresAt] =
        params as [string, string, string, number, number, Date];
      store.set(sessionToken, {
        phone,
        session_token: sessionToken,
        code_hash: codeHash,
        attempts: 0,
        max_attempts: maxAttempts,
        cooldown_seconds: cooldownSeconds,
        expires_at: new Date(expiresAt),
      });
      return response([]);
    }

    if (normalizedSql.startsWith('SELECT id, phone, session_token, code_hash, attempts, max_attempts, cooldown_seconds, sent_at, expires_at FROM auth_phone_otps WHERE session_token = ? LIMIT 1')) {
      const [sessionToken] = params as [string];
      const row = store.get(sessionToken);
      return response(row ? [{ id: 1, sent_at: new Date(), ...row }] : []);
    }

    if (normalizedSql.startsWith('UPDATE auth_phone_otps SET attempts = ? WHERE session_token = ?')) {
      const [attempts, sessionToken] = params as [number, string];
      const row = store.get(sessionToken);
      if (row) {
        row.attempts = attempts;
        store.set(sessionToken, row);
      }
      return response([]);
    }

    throw new Error(`Unexpected SQL in test: ${normalizedSql}`);
  });
});

describe('phoneOtpService', () => {
  it('issues, resends and verifies OTPs from persistent storage', async () => {
    const { phoneOtpService } = await import('../../src/services/phoneOtpService');

    const first = await phoneOtpService.requestOtp('(62) 99999-8888');
    expect(first.sessionToken).toBeTypeOf('string');
    expect(first.code).toMatch(/^\d{6}$/);
    expect(store.size).toBe(1);

    const resent = await phoneOtpService.resendOtp(first.sessionToken);
    expect(resent).not.toBeNull();
    expect(resent?.sessionToken).not.toBe(first.sessionToken);
    expect(store.size).toBe(1);

    const oldVerify = await phoneOtpService.verifyOtp(first.sessionToken, first.code);
    expect(oldVerify).toEqual({ ok: false, reason: 'INVALID_SESSION' });

    const second = resent!;
    const verify = await phoneOtpService.verifyOtp(second.sessionToken, second.code);
    expect(verify).toEqual({ ok: true, phone: '62999998888' });
    expect(store.size).toBe(0);
  });

  it('increments attempts and locks after too many invalid codes', async () => {
    const { phoneOtpService } = await import('../../src/services/phoneOtpService');

    const issue = await phoneOtpService.requestOtp('62999990000');
    for (let i = 0; i < 5; i += 1) {
      const result = await phoneOtpService.verifyOtp(issue.sessionToken, '000000');
      expect(result).toEqual({ ok: false, reason: 'INVALID_CODE' });
    }

    expect(store.size).toBe(0);
  });
});
