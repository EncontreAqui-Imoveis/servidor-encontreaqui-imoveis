import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  issueEmailCodeChallengeMock,
  deleteEmailCodeChallengeMock,
  getEmailVerificationStatusMock,
  verifyEmailCodeMock,
  sendEmailCodeEmailMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  issueEmailCodeChallengeMock: vi.fn(),
  deleteEmailCodeChallengeMock: vi.fn(),
  getEmailVerificationStatusMock: vi.fn(),
  verifyEmailCodeMock: vi.fn(),
  sendEmailCodeEmailMock: vi.fn(),
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
      generateEmailVerificationLink: vi.fn(),
      createUser: vi.fn(),
      getUserByEmail: vi.fn(),
      updateUser: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/emailCodeChallengeService', () => ({
  issueEmailCodeChallenge: issueEmailCodeChallengeMock,
  deleteEmailCodeChallenge: deleteEmailCodeChallengeMock,
  getEmailVerificationStatus: getEmailVerificationStatusMock,
  verifyEmailCode: verifyEmailCodeMock,
  verifyPasswordResetCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
}));

vi.mock('../../src/services/emailService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/emailService')>(
    '../../src/services/emailService'
  );
  return {
    ...actual,
    sendEmailCodeEmail: sendEmailCodeEmailMock,
  };
});

describe('POST /auth/email-verification/*', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends first verification code with cooldown 60s', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 42,
          name: 'Usuario Teste',
          email_verified_at: null,
        },
      ],
    ]);
    issueEmailCodeChallengeMock.mockResolvedValueOnce({
      allowed: true,
      requestId: 1,
      code: '123456',
      attemptNumber: 1,
      expiresAt: new Date('2026-03-06T10:15:00.000Z'),
      cooldownSec: 60,
      dailyRemaining: 4,
      resendType: 'initial',
    });

    const response = await request(app)
      .post('/auth/email-verification/send')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.delivery).toBe('sent');
    expect(issueEmailCodeChallengeMock).toHaveBeenCalledWith({
      email: 'user@test.com',
      purpose: 'verify_email',
      userId: 42,
    });
    expect(sendEmailCodeEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        name: 'Usuario Teste',
        code: '123456',
        purpose: 'verify_email',
        idempotencyKey: 'email-verification-1',
      })
    );
  });

  it('returns already verified when user has email_verified_at', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 42,
          name: 'Usuario Teste',
          email_verified_at: '2026-03-06T10:00:00.000Z',
        },
      ],
    ]);

    const response = await request(app)
      .post('/auth/email-verification/send')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(200);
    expect(response.body.delivery).toBe('already_verified');
    expect(sendEmailCodeEmailMock).not.toHaveBeenCalled();
  });

  it('blocks resend when cooldown is active', async () => {
    queryMock.mockResolvedValueOnce([[{ id: 42, name: 'Usuario', email_verified_at: null }]]);
    issueEmailCodeChallengeMock.mockResolvedValueOnce({
      allowed: false,
      code: 'EMAIL_RESEND_RATE_LIMITED',
      retryAfterSeconds: 45,
      dailyRemaining: 3,
    });

    const response = await request(app)
      .post('/auth/email-verification/send')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(429);
    expect(response.body.code).toBe('EMAIL_RESEND_RATE_LIMITED');
    expect(sendEmailCodeEmailMock).not.toHaveBeenCalled();
  });

  it('verifies email code successfully', async () => {
    verifyEmailCodeMock.mockResolvedValueOnce({
      status: 'verified',
      verifiedAt: new Date('2026-03-06T10:20:00.000Z'),
      challengeId: 10,
    });

    const response = await request(app)
      .post('/auth/email-verification/verify-code')
      .send({ email: 'user@test.com', code: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.verified).toBe(true);
  });

  it('maps pending status from /check using database-backed state', async () => {
    getEmailVerificationStatusMock.mockResolvedValueOnce({
      status: 'pending',
      expiresAt: new Date('2026-03-06T10:20:00.000Z'),
    });

    const response = await request(app)
      .post('/auth/email-verification/check')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_VERIFICATION_PENDING');
  });
});
