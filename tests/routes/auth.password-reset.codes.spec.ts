import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  issueEmailCodeChallengeMock,
  deleteEmailCodeChallengeMock,
  verifyPasswordResetCodeMock,
  confirmPasswordResetMock,
  sendEmailCodeEmailMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  issueEmailCodeChallengeMock: vi.fn(),
  deleteEmailCodeChallengeMock: vi.fn(),
  verifyPasswordResetCodeMock: vi.fn(),
  confirmPasswordResetMock: vi.fn(),
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
  getEmailVerificationStatus: vi.fn(),
  verifyEmailCode: vi.fn(),
  verifyPasswordResetCode: verifyPasswordResetCodeMock,
  confirmPasswordReset: confirmPasswordResetMock,
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

describe('POST /auth/password-reset/*', () => {
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

  it('sends reset code for local-password accounts', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 7,
          name: 'Cliente Teste',
          firebase_uid: 'firebase-1',
          password_hash: 'hash',
        },
      ],
    ]);
    issueEmailCodeChallengeMock.mockResolvedValueOnce({
      allowed: true,
      requestId: 2,
      code: '654321',
      attemptNumber: 1,
      expiresAt: new Date('2026-03-06T10:15:00.000Z'),
      cooldownSec: 60,
      dailyRemaining: 4,
      resendType: 'initial',
    });

    const response = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(200);
    expect(sendEmailCodeEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@test.com',
        purpose: 'password_reset',
        code: '654321',
        idempotencyKey: 'password-reset-2',
      })
    );
  });

  it('keeps generic success for Google-only accounts', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 7,
          name: 'Cliente Teste',
          firebase_uid: 'firebase-1',
          password_hash: null,
        },
      ],
    ]);

    const response = await request(app)
      .post('/auth/password-reset/request')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(200);
    expect(sendEmailCodeEmailMock).not.toHaveBeenCalled();
  });

  it('returns reset session token when code is valid', async () => {
    verifyPasswordResetCodeMock.mockResolvedValueOnce({
      status: 'verified',
      challengeId: 8,
      resetSessionToken: 'reset-session-token',
      expiresAt: new Date('2026-03-06T10:30:00.000Z'),
    });

    const response = await request(app)
      .post('/auth/password-reset/verify-code')
      .send({ email: 'user@test.com', code: '654321' });

    expect(response.status).toBe(200);
    expect(response.body.reset_session_token).toBe('reset-session-token');
  });

  it('confirms password reset with a valid reset session token', async () => {
    confirmPasswordResetMock.mockResolvedValueOnce({
      status: 'consumed',
      consumedAt: new Date('2026-03-06T10:45:00.000Z'),
    });

    const response = await request(app)
      .post('/auth/password-reset/confirm')
      .send({
        email: 'user@test.com',
        reset_session_token: 'reset-session-token',
        new_password: '123456',
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
