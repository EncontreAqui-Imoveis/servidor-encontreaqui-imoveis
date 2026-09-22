import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { googleSessionMock, socialSessionMock } = vi.hoisted(() => ({
  googleSessionMock: vi.fn(),
  socialSessionMock: vi.fn(),
}));

vi.mock('../../src/services/authSessionOperationsService', () => ({
  google: googleSessionMock,
  social: socialSessionMock,
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

  it('returns a structured 401 when Firebase rejects the token', async () => {
    const { UnauthorizedError } = await import('../../src/errors/ApplicationError');
    googleSessionMock.mockRejectedValueOnce(
      new UnauthorizedError('Não foi possível validar sua sessão com o Google. Faça login novamente.', {
        code: 'GOOGLE_TOKEN_INVALID',
        retryable: false,
      }),
    );

    const response = await request(app)
      .post('/auth/google')
      .send({ idToken: 'invalid-token', profileType: 'auto' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'GOOGLE_TOKEN_INVALID',
      retryable: false,
    });
  });

  it('returns a structured 409 when social identities conflict', async () => {
    const { ConflictError } = await import('../../src/errors/ApplicationError');
    googleSessionMock.mockRejectedValueOnce(
      new ConflictError('Não foi possível associar esta conta social a uma conta existente.', {
        code: 'SOCIAL_IDENTITY_CONFLICT',
        retryable: false,
      }),
    );

    const response = await request(app)
      .post('/auth/google')
      .send({ idToken: 'google-token', profileType: 'auto' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      status: 'error',
      code: 'SOCIAL_IDENTITY_CONFLICT',
      retryable: false,
    });
  });
});

describe('POST /auth/social', () => {
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

  it('accepts a verified social token and returns the existing new-user handshake', async () => {
    socialSessionMock.mockResolvedValueOnce({
      isNewUser: true,
      requiresProfileChoice: true,
      pending: {
        email: 'novo@exemplo.com', name: 'Novo Usuario',
        firebaseUid: 'firebase-uid-123', provider: 'google.com',
      },
      provider: 'google.com', roleLocked: false, needsCompletion: true,
      requiresDocuments: false, requestedProfile: 'auto',
    });

    const response = await request(app)
      .post('/auth/social')
      .send({ idToken: 'firebase-social-token', profileType: 'auto', provider: 'forged' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      isNewUser: true, requiresProfileChoice: true, provider: 'google.com',
      pending: { firebaseUid: 'firebase-uid-123', provider: 'google.com' },
    });
    expect(socialSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      idToken: 'firebase-social-token', profileType: 'auto',
    }));
    expect(socialSessionMock.mock.calls[0][0]).not.toHaveProperty('provider');
  });

  it('returns a structured 409 for a social identity conflict', async () => {
    const { ConflictError } = await import('../../src/errors/ApplicationError');
    socialSessionMock.mockRejectedValueOnce(new ConflictError('Conflito de identidade.', {
      code: 'SOCIAL_IDENTITY_CONFLICT', retryable: false,
    }));

    const response = await request(app).post('/auth/social').send({ idToken: 'firebase-social-token' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ status: 'error', code: 'SOCIAL_IDENTITY_CONFLICT' });
  });
});
