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

describe('rate limit de autenticação (MV-001)', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    const { default: userRoutes } = await import('../../src/routes/user.routes');

    app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use('/users', userRoutes);
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([[]]);
  });

  it('rotas light não devem bloquear uso legítimo em curto intervalo (check-email)', async () => {
    const responses: number[] = [];

    for (let i = 0; i < 50; i++) {
      const response = await request(app).get('/auth/check-email').query({
        email: `teste${i}@dominio.com`,
      });

      responses.push(response.status);
      expect(response.status).not.toBe(429);
      expect(response.body).toEqual({ exists: false, hasFirebaseUid: false, hasPassword: false });
    }

    expect(responses.every((status) => status === 200)).toBe(true);
  });

  it('rotas light não devem bloquear uso legítimo em curto intervalo (check-creci)', async () => {
    const responses: number[] = [];

    for (let i = 0; i < 50; i++) {
      const response = await request(app).get('/auth/check-creci').query({
        creci: '1234-A',
      });

      responses.push(response.status);
      expect(response.status).not.toBe(429);
      expect(response.body).toEqual({ exists: false });
    }

    expect(responses.every((status) => status === 200)).toBe(true);
  });

  it('rota sensível bloqueia abuso real e mantém mensagem canônica de 429', async () => {
    let status = 200;
    let last: any;

    for (let i = 0; i < 25; i++) {
      const response = await request(app).post('/auth/login').send({
        email: 'curto@dominio.com',
      });

      status = response.status;
      last = response;

      if (i < 20) {
        expect(response.status).toBe(400);
      }
    }

    expect(status).toBe(429);
    expect(last.body).toMatchObject({
      error: 'Muitas tentativas em rotas de autenticacao. Tente novamente em instantes.',
    });
  });

  it('rota legacy também bloqueia abuso real e mantém mensagem canônica de 429', async () => {
    let status = 200;
    let last: any;

    for (let i = 0; i < 25; i++) {
      const response = await request(app).post('/users/login').send({
        email: 'curto@dominio.com',
      });

      status = response.status;
      last = response;

      if (i < 20) {
        expect(response.status).toBe(400);
      }
    }

    expect(status).toBe(429);
    expect(last.body).toMatchObject({
      error: 'Muitas tentativas em rotas legadas de autenticacao. Use /auth/*.',
    });
  });

  it('rate-limit responde cabeçalho padrão e não depende de Retry-After se não houver', async () => {
    let response;

    for (let i = 0; i < 25; i++) {
      response = await request(app).post('/auth/login').send({
        email: 'header-check@dominio.com',
      });
    }

    expect(response).toBeTruthy();
    expect(response!.status).toBe(429);
    const headerKeys = Object.keys(response!.headers);
    const hasRateLimitHeader = headerKeys.some((headerName) =>
      headerName.toLowerCase().startsWith('ratelimit-'),
    );
    const hasRetryAfter = Object.prototype.hasOwnProperty.call(response!.headers, 'retry-after');
    expect(hasRateLimitHeader || hasRetryAfter).toBe(true);
  });

  it('trust proxy + X-Forwarded-For compartilha limite por IP de origem canônico', async () => {
    for (let i = 0; i < 25; i++) {
      const response = await request(app)
        .post('/users/login')
        .set('x-forwarded-for', '203.0.113.10')
        .send({ email: 'xff@dominio.com' });

      if (i < 20) {
        expect(response.status).toBe(400);
      }
      if (i === 24) {
        expect(response.status).toBe(429);
      }
    }

    const afterSharedIp = await request(app)
      .post('/users/login')
      .set('x-forwarded-for', '198.51.100.20')
      .send({ email: 'outro-ip@dominio.com' });

    expect(afterSharedIp.status).toBe(400);
  });
});

