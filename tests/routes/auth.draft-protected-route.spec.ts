import express from 'express';
import jwt from 'jsonwebtoken';
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

describe('Rotas protegidas não aceitam rascunho não consolidado', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: userRoutes } = await import('../../src/routes/user.routes');
    app = express();
    app.use(express.json());
    app.use('/users', userRoutes);
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita /users/me sem token', async () => {
    const response = await request(app).get('/users/me');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Token não fornecido.');
  });

  it('rejeita /users/me com token inválido', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
    const response = await request(app)
      .get('/users/me')
      .set('authorization', 'Bearer token-invalido');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Token inválido.');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('rejeita token JWT assinado com algoritmo diferente de HS256', async () => {
    const token = jwt.sign(
      { id: 1, role: 'client', token_version: 1 },
      process.env.JWT_SECRET!,
      { algorithm: 'HS384', expiresIn: '1h' },
    );
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await request(app)
        .get('/users/me')
        .set('authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Token inválido.');
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
