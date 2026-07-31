import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../src/config/rateLimiters', () => ({
  createAuthLightLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createAuthLoginLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createAuthSensitiveLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createAuthRegistrationLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createOtpVerificationLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createPreAuthUploadLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe('POST /auth/verify-phone', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retires the public profile lookup without querying user data', async () => {
    const response = await request(app)
      .post('/auth/verify-phone')
      .send({ email: 'qualquer@teste.com' });

    expect(response.status).toBe(410);
    expect(response.body).toEqual({
      code: 'LEGACY_ENDPOINT_RETIRED',
      error: 'Este endpoint foi desativado. Use a verificação no cadastro.',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns a generic result from check-email without querying account data', async () => {
    const response = await request(app).get('/auth/check-email?email=qualquer@teste.com');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      exists: false,
      hasFirebaseUid: false,
      hasPassword: false,
    });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
