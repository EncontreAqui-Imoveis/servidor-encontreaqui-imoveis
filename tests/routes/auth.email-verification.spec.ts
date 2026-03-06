import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, getUserByEmailMock, generateEmailVerificationLinkMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getUserByEmailMock: vi.fn(),
  generateEmailVerificationLinkMock: vi.fn(),
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
      getUserByEmail: getUserByEmailMock,
      generateEmailVerificationLink: generateEmailVerificationLinkMock,
      createUser: vi.fn(),
    }),
  },
}));

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

  it('sends first verification attempt with initial state and cooldown 60s', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 42 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 1 }]);
    generateEmailVerificationLinkMock.mockResolvedValueOnce('https://verify.example.com/link');

    const response = await request(app)
      .post('/auth/email-verification/send')
      .send({ email: 'user@test.com' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.resend_type).toBe('initial');
    expect(response.body.cooldown_sec).toBe(60);
    expect(response.body.daily_remaining).toBe(4);
    expect(generateEmailVerificationLinkMock).toHaveBeenCalledWith('user@test.com');
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
    expect(generateEmailVerificationLinkMock).not.toHaveBeenCalled();
  });

  it('returns verified=true when provider reports verified email', async () => {
    getUserByEmailMock.mockResolvedValueOnce({ emailVerified: true });
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .post('/auth/email-verification/check')
      .send({ email: 'verified@test.com' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.verified).toBe(true);
  });

  it('returns EMAIL_LINK_EXPIRED when latest link is expired', async () => {
    getUserByEmailMock.mockResolvedValueOnce({ emailVerified: false });
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
      .send({ email: 'expired@test.com' });

    expect(response.status).toBe(410);
    expect(response.body.code).toBe('EMAIL_LINK_EXPIRED');
    expect(response.body.retryable).toBe(true);
  });
});
