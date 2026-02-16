import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { phoneOtpService } from '../../src/services/phoneOtpService';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(),
      getUserByEmail: vi.fn(),
      createUser: vi.fn(),
    }),
  },
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
  });

  beforeEach(() => {
    vi.clearAllMocks();
    phoneOtpService.clearForTests();
  });

  it('invalidates old code after resend and accepts only the new code', async () => {
    const requestResponse = await request(app)
      .post('/auth/otp/request')
      .send({ phone: '+55 (64) 99999-0000' });

    expect(requestResponse.status).toBe(200);
    expect(requestResponse.body.sessionToken).toBeTypeOf('string');
    expect(requestResponse.body.otpCode).toBeTypeOf('string');

    const tokenA = requestResponse.body.sessionToken as string;
    const codeA = requestResponse.body.otpCode as string;

    const resendResponse = await request(app)
      .post('/auth/otp/resend')
      .send({ sessionToken: tokenA });

    expect(resendResponse.status).toBe(200);
    expect(resendResponse.body.sessionToken).toBeTypeOf('string');
    expect(resendResponse.body.otpCode).toBeTypeOf('string');

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

