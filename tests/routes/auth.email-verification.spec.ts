import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  verifyIdTokenMock,
  generateEmailVerificationLinkMock,
  sendEmailVerificationEmailMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
  generateEmailVerificationLinkMock: vi.fn(),
  sendEmailVerificationEmailMock: vi.fn(),
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
      verifyIdToken: verifyIdTokenMock,
      generateEmailVerificationLink: generateEmailVerificationLinkMock,
      createUser: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/emailService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/emailService')>(
    '../../src/services/emailService'
  );
  return {
    ...actual,
    sendEmailVerificationEmail: sendEmailVerificationEmailMock,
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
    process.env.EMAIL_VERIFICATION_HANDLER_URL =
      'https://imoveis.exemplo.com/auth/verificar-email';
  });

  it('sends first verification attempt with initial state and cooldown 60s', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 42, name: 'Usuario Teste' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 1 }]);
    generateEmailVerificationLinkMock.mockResolvedValueOnce(
      'https://encontreaqui-imoveis.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=code-123&apiKey=legacy'
    );

    const response = await request(app)
      .post('/auth/email-verification/send')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.resend_type).toBe('initial');
    expect(response.body.cooldown_sec).toBe(60);
    expect(response.body.daily_remaining).toBe(4);
    expect(generateEmailVerificationLinkMock).toHaveBeenCalledWith('user@test.com');
    expect(sendEmailVerificationEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailVerificationEmailMock.mock.calls[0][0]).toMatchObject({
      to: 'user@test.com',
      name: 'Usuario Teste',
    });
    expect(sendEmailVerificationEmailMock.mock.calls[0][0].actionUrl).toContain(
      'https://imoveis.exemplo.com/auth/verificar-email?'
    );
    expect(sendEmailVerificationEmailMock.mock.calls[0][0].actionUrl).toContain(
      'oobCode=code-123'
    );
  });

  it('blocks resend when cooldown is active', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 42 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 100,
            sent_at: new Date(),
            expires_at: new Date(Date.now() + 15 * 60 * 1000),
            status: 'sent',
          },
        ],
      ]);

    const response = await request(app)
      .post('/auth/email-verification/send')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(429);
    expect(response.body.code).toBe('EMAIL_RESEND_RATE_LIMITED');
    expect(response.body.retryable).toBe(true);
    expect(sendEmailVerificationEmailMock).not.toHaveBeenCalled();
  });

  it('returns verified=true when provider reports verified email', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'verified@test.com',
      email_verified: true,
    });
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .post('/auth/email-verification/check')
      .send({ email: 'verified@test.com', idToken: 'token-ok' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.verified).toBe(true);
  });

  it('rejects mismatched email token', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'other@test.com',
      email_verified: true,
    });

    const response = await request(app)
      .post('/auth/email-verification/check')
      .send({ email: 'verified@test.com', idToken: 'token-mismatch' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('EMAIL_TOKEN_MISMATCH');
  });

  it('returns EMAIL_LINK_EXPIRED when latest link is expired', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      email: 'expired@test.com',
      email_verified: false,
    });
    queryMock
      .mockResolvedValueOnce([
        [
          {
            id: 10,
            sent_at: new Date(Date.now() - 16 * 60 * 1000),
            expires_at: new Date(Date.now() - 60 * 1000),
            status: 'sent',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .post('/auth/email-verification/check')
      .send({ email: 'expired@test.com', idToken: 'token-expired-check' });

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('EMAIL_LINK_EXPIRED');
    expect(response.body.retryable).toBe(true);
  });
});
