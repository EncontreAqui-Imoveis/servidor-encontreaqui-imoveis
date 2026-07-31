import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET ??= 'test-secret';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: { query: queryMock },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: { userId?: number; userRole?: string }, _res: unknown, next: () => void) => {
    req.userId = 44;
    req.userRole = 'broker';
    next();
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: { auth: () => ({ verifyIdToken: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn() }) },
}));

vi.mock('../../src/config/rateLimiters', () => ({
  createAuthLoginLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createAuthRegistrationLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  createAuthSensitiveLimiter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe('User lookup and sync security', () => {
  let app: express.Express;
  const originalSyncSecret = process.env.SYNC_SECRET_KEY;

  beforeAll(async () => {
    const { default: userRoutes } = await import('../../src/routes/user.routes');
    app = express();
    app.use(express.json());
    app.use('/users', userRoutes);
  });

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    if (originalSyncSecret == null) delete process.env.SYNC_SECRET_KEY;
    else process.env.SYNC_SECRET_KEY = originalSyncSecret;
  });

  it('fails closed when the sync secret is absent', async () => {
    delete process.env.SYNC_SECRET_KEY;
    const response = await request(app)
      .post('/users/sync')
      .send({ uid: 'firebase-id', email: 'buyer@example.com' });

    expect(response.status).toBe(503);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid sync secret', async () => {
    process.env.SYNC_SECRET_KEY = 'configured-secret';
    const response = await request(app)
      .post('/users/sync')
      .set('x-sync-secret', 'wrong-secret')
      .send({ uid: 'firebase-id', email: 'buyer@example.com' });

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects a repeated sync-secret header', async () => {
    process.env.SYNC_SECRET_KEY = 'configured-secret';
    const response = await request(app)
      .post('/users/sync')
      .set('x-sync-secret', ['configured-secret', 'configured-secret'])
      .send({ uid: 'firebase-id', email: 'buyer@example.com' });

    expect(response.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('accepts the configured secret without returning it', async () => {
    process.env.SYNC_SECRET_KEY = 'configured-secret';
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app)
      .post('/users/sync')
      .set('x-sync-secret', 'configured-secret')
      .send({ uid: 'firebase-id', email: 'buyer@example.com' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: 'Usuário sincronizado com sucesso!' });
    expect(JSON.stringify(response.body)).not.toContain('configured-secret');
    expect(queryMock).toHaveBeenCalledTimes(3);
  });

  it.each(['Maria', '000.000.000-00', 'buyer@example', 'buyer.example.com'])(
    'does not search accounts by name, CPF, or malformed e-mail: %s',
    async (query) => {
      const response = await request(app).get(`/users/search?q=${encodeURIComponent(query)}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: [] });
      expect(queryMock).not.toHaveBeenCalled();
    },
  );

  it('normalizes an exact e-mail and excludes the requesting account', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app).get('/users/search?q=%20BUYER%40EXAMPLE.COM%20');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: [] });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('u.id <> ?'),
      [44, 'buyer@example.com'],
    );
  });

  it('looks up one exact e-mail and never returns personal fields', async () => {
    queryMock.mockResolvedValueOnce([[
      {
        id: 88,
        name: 'Comprador Legal',
        email: 'buyer@example.com',
        cpf: '00000000000',
        phone: '64999999999',
        firebase_uid: 'firebase-private-id',
      },
    ]]);

    const response = await request(app).get('/users/search?q=BUYER%40EXAMPLE.COM');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [{ id: 88, name: 'Comprador Legal', email: 'buyer@example.com' }],
    });
    const sql = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(sql).toContain('LOWER(TRIM(u.email)) = ?');
    expect(sql).not.toContain('u.cpf');
    expect(sql).not.toContain('u.phone');
    expect(JSON.stringify(response.body)).not.toMatch(/00000000000|64999999999|firebase-private-id/);
  });
});
