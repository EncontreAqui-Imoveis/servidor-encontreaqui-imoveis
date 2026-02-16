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

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 123;
    req.userRole = 'client';
    next();
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

describe('PUT /users/me profile update', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: userRoutes } = await import('../../src/routes/user.routes');
    app = express();
    app.use(express.json());
    app.use('/users', userRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows partial update with only name', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 1 }]);
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 123,
          name: 'Nome Atualizado',
          email: 'user@test.com',
          phone: '64999999999',
          street: 'Rua A',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Rio Verde',
          state: 'GO',
          cep: '75908220',
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .put('/users/me')
      .send({ name: 'Nome Atualizado' });

    expect(response.status).toBe(200);
    expect(response.body.user.name).toBe('Nome Atualizado');
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE users SET name = ? WHERE id = ?'),
      ['Nome Atualizado', 123]
    );
  });

  it('returns specific validation message for invalid email format', async () => {
    const response = await request(app)
      .put('/users/me')
      .send({ email: 'email-invalido' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      message: 'Email invalido.',
      error: 'Email invalido.',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });
});

