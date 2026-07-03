import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { googleSessionMock } = vi.hoisted(() => ({
  googleSessionMock: vi.fn(),
}));

vi.mock('../../src/services/authSessionOperationsService', () => ({
  google: googleSessionMock,
  login: vi.fn(),
  logout: vi.fn(),
}));

describe('POST /auth/google', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    vi.resetModules();
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns isNewUser payload without creating user in database', async () => {
    googleSessionMock.mockResolvedValueOnce({
      isNewUser: true,
      requiresProfileChoice: true,
      pending: {
        email: 'novo@exemplo.com',
        name: 'Novo Usuario',
        googleUid: 'google-uid-123',
      },
      roleLocked: false,
      needsCompletion: true,
      requiresDocuments: false,
      requestedProfile: 'auto',
    });

    const response = await request(app)
      .post('/auth/google')
      .send({ idToken: 'google-token', profileType: 'auto' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      isNewUser: true,
      requiresProfileChoice: true,
      pending: {
        email: 'novo@exemplo.com',
        name: 'Novo Usuario',
        googleUid: 'google-uid-123',
      },
    });
  });

  it('logs in existing broker and returns token payload', async () => {
    googleSessionMock.mockResolvedValueOnce({
      user: {
        id: 42,
        email: 'broker@exemplo.com',
        role: 'broker',
        broker: {
          id: 42,
          status: 'pending_verification',
          creci: '12345-F',
        },
      },
      token: 'jwt-test-token',
      needsCompletion: false,
      requiresDocuments: true,
      blockedBrokerRequest: false,
      roleLocked: true,
      isNewUser: false,
      requestedProfile: 'auto',
    });

    const response = await request(app)
      .post('/auth/google')
      .send({ idToken: 'google-token', profileType: 'auto' });

    expect(response.status).toBe(200);
    expect(response.body.isNewUser).toBe(false);
    expect(typeof response.body.token).toBe('string');
    expect(response.body.user).toMatchObject({
      id: 42,
      email: 'broker@exemplo.com',
      role: 'broker',
      broker: {
        id: 42,
        status: 'pending_verification',
        creci: '12345-F',
      },
    });
  });
});
