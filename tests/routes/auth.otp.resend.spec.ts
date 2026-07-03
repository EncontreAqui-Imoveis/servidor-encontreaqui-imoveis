import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FakeOtpSession = {
  sessionToken: string;
  phone: string;
  code: string;
  expiresAt: Date;
};

const otpSessions = new Map<string, FakeOtpSession>();

const { nextTokenMock, nextCodeMock } = vi.hoisted(() => ({
  nextTokenMock: vi.fn(),
  nextCodeMock: vi.fn(),
}));

vi.mock('../../src/services/phoneOtpService', () => ({
  phoneOtpService: {
    requestOtp: vi.fn(async (phone: string) => {
      const sessionToken = `token-${nextTokenMock()}`;
      const code = String(nextCodeMock()).padStart(6, '0');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      otpSessions.forEach((session, token) => {
        if (session.phone === phone) {
          otpSessions.delete(token);
        }
      });
      otpSessions.set(sessionToken, { sessionToken, phone, code, expiresAt });
      return { sessionToken, expiresAt, code };
    }),
    resendOtp: vi.fn(async (sessionToken: string) => {
      const existing = otpSessions.get(sessionToken);
      if (!existing) {
        return null;
      }
      otpSessions.delete(sessionToken);
      const nextSessionToken = `token-${nextTokenMock()}`;
      const code = String(nextCodeMock()).padStart(6, '0');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      otpSessions.set(nextSessionToken, {
        sessionToken: nextSessionToken,
        phone: existing.phone,
        code,
        expiresAt,
      });
      return { sessionToken: nextSessionToken, expiresAt, code };
    }),
    verifyOtp: vi.fn(async (sessionToken: string, code: string) => {
      const existing = otpSessions.get(sessionToken);
      if (!existing) {
        return { ok: false, reason: 'INVALID_SESSION' as const };
      }
      if (existing.expiresAt.getTime() <= Date.now()) {
        otpSessions.delete(sessionToken);
        return { ok: false, reason: 'EXPIRED' as const };
      }
      if (existing.code !== code) {
        return { ok: false, reason: 'INVALID_CODE' as const };
      }
      otpSessions.delete(sessionToken);
      return { ok: true as const, phone: existing.phone };
    }),
  },
}));

vi.mock('../../src/config/redis', () => ({
  resolveRedisConfig: () => ({
    config: undefined,
    reason: 'mocked test environment without redis',
    source: 'missing' as const,
  }),
  getRedisConfigForPdfQueue: () => ({
    config: undefined,
    reason: 'mocked test environment without redis',
    source: 'missing' as const,
  }),
}));

describe('POST /auth/otp/resend flow', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.NODE_ENV = 'test';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  }, 30000);

  beforeEach(() => {
    otpSessions.clear();
    nextTokenMock.mockReset();
    nextCodeMock.mockReset();
    nextTokenMock.mockReturnValueOnce(1).mockReturnValueOnce(2);
    nextCodeMock.mockReturnValueOnce(123456).mockReturnValueOnce(654321);
  });

  it('invalidates old code after resend and accepts only the new code', async () => {
    const requestResponse = await request(app)
      .post('/auth/otp/request')
      .send({ phone: '+55 (64) 99999-0000' });

    expect(requestResponse.status).toBe(200);
    expect(requestResponse.body.sessionToken).toBe('token-1');
    expect(requestResponse.body.otpCode).toBe('123456');

    const tokenA = requestResponse.body.sessionToken as string;
    const codeA = requestResponse.body.otpCode as string;

    const resendResponse = await request(app)
      .post('/auth/otp/resend')
      .send({ sessionToken: tokenA });

    expect(resendResponse.status).toBe(200);
    expect(resendResponse.body.sessionToken).toBe('token-2');
    expect(resendResponse.body.otpCode).toBe('654321');

    const tokenB = resendResponse.body.sessionToken as string;
    const codeB = resendResponse.body.otpCode as string;

    expect(tokenB).not.toBe(tokenA);
    expect(codeB).not.toBe(codeA);

    const verifyOldResponse = await request(app)
      .post('/auth/otp/verify')
      .send({ sessionToken: tokenA, code: codeA });

    expect(verifyOldResponse.status).toBe(400);
    expect(verifyOldResponse.body).toEqual({
      error: 'Codigo invalido ou expirado.',
    });

    const verifyNewResponse = await request(app)
      .post('/auth/otp/verify')
      .send({ sessionToken: tokenB, code: codeB });

    expect(verifyNewResponse.status).toBe(200);
    expect(verifyNewResponse.body).toEqual({ ok: true });
  });
});
