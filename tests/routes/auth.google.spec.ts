import express from 'express';
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

describe('POST /auth/google', () => {
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

  it('returns isNewUser payload without creating user in database', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'google-uid-123',
      email: 'novo@exemplo.com',
      name: 'Novo Usuario',
    });
    queryMock.mockResolvedValueOnce([[]]);

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

    const allSqlCalls = queryMock.mock.calls.map(([sql]) => String(sql).toUpperCase());
    expect(allSqlCalls.some((sql) => sql.includes('INSERT INTO USERS'))).toBe(false);
  });

  it('logs in existing broker and returns token payload', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'google-uid-456',
      email: 'broker@exemplo.com',
      name: 'Broker Existing',
    });

    queryMock.mockResolvedValueOnce([
      [
        {
          id: 42,
          name: 'Broker Existing',
          email: 'broker@exemplo.com',
          phone: '62999998888',
          street: 'Rua A',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Rio Verde',
          state: 'GO',
          cep: '75900000',
          firebase_uid: 'google-uid-456',
          broker_id: 42,
          broker_status: 'pending_verification',
          creci: '12345-F',
          broker_documents_status: 'pending',
        },
      ],
    ]);

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

    const allSqlCalls = queryMock.mock.calls.map(([sql]) => String(sql).toUpperCase());
    expect(allSqlCalls.some((sql) => sql.includes('INSERT INTO USERS'))).toBe(false);
  });
});
