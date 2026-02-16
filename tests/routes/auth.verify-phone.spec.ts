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

describe('POST /auth/verify-phone', () => {
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

  it('returns 400 when email is missing', async () => {
    const response = await request(app)
      .post('/auth/verify-phone')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Email e obrigatorio.',
    });
  });

  it('returns 404 when user does not exist', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app)
      .post('/auth/verify-phone')
      .send({ email: 'naoexiste@teste.com' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'Usuario nao encontrado.',
    });
  });

  it('returns nested broker payload with pending_verification status', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 30003,
          name: 'PedroMCorretor',
          email: 'testec@gmail.com',
          phone: '12345678901',
          street: 'Rua 105',
          number: '323',
          complement: 'asdds',
          bairro: 'De Lourdes',
          city: 'Rio Verde',
          state: 'GO',
          cep: '75908220',
          broker_id: 30003,
          broker_status: 'pending_verification',
          creci: '343434-F',
        },
      ],
    ]);

    const response = await request(app)
      .post('/auth/verify-phone')
      .send({ email: 'testec@gmail.com' });

    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe('broker');
    expect(response.body.user.broker).toEqual({
      id: 30003,
      status: 'pending_verification',
      creci: '343434-F',
    });
    expect(response.body.broker).toEqual({
      id: 30003,
      status: 'pending_verification',
      creci: '343434-F',
    });
  });
});
