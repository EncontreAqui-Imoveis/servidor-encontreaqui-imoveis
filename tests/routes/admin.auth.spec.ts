import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, compareMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  compareMock: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: compareMock,
  },
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 77;
    req.userRole = 'admin';
    next();
  },
  isAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

describe('Admin auth routes', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: adminRoutes } = await import('../../src/routes/admin.routes');
    app = express();
    app.use(express.json());
    app.use('/admin', adminRoutes);
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /admin/login authenticates admin and returns token', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 77,
          name: 'Admin Teste',
          email: 'admin@example.com',
          password_hash: '$2a$10$hash',
          token_version: 3,
        },
      ],
      [],
    ]);
    compareMock.mockResolvedValueOnce(true);

    const response = await request(app)
      .post('/admin/login')
      .send({ email: 'admin@example.com', password: 'secret' });

    expect(response.status).toBe(200);
    expect(response.body.admin).toMatchObject({
      id: 77,
      name: 'Admin Teste',
      email: 'admin@example.com',
    });
    expect(response.body.token).toEqual(expect.any(String));
  });

  it('POST /admin/logout invalidates token version', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).post('/admin/logout');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Logout realizado com sucesso.' });
    expect(queryMock).toHaveBeenCalledWith(
      'UPDATE admins SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [77]
    );
  });

  it('POST /admin/reauth returns a reauth token for valid password', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 77,
          password_hash: '$2a$10$hash',
          token_version: 3,
        },
      ],
      [],
    ]);
    compareMock.mockResolvedValueOnce(true);

    const response = await request(app).post('/admin/reauth').send({ password: 'secret' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reauthToken: expect.any(String),
      expiresInSeconds: 600,
    });
  });
});
