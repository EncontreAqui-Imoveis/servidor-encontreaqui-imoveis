import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, verifyIdTokenMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
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
      getUserByEmail: vi.fn(),
      createUser: vi.fn(),
    }),
  },
}));

describe('POST /auth/logout', () => {
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

  it('revokes the current user token version and rejects the stale token on the next request', async () => {
    const token = jwt.sign(
      {
        id: 77,
        role: 'client',
        token_version: 1,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' }
    );

    queryMock
      .mockResolvedValueOnce([[{ id: 77, token_version: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 77, token_version: 2 }]]);

    const firstResponse = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body).toEqual({
      message: 'Logout realizado com sucesso.',
    });

    const secondResponse = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(secondResponse.status).toBe(401);
    expect(secondResponse.body.error).toMatch(/Sessao revogada/i);
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});
