import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthRequest } from '../../src/middlewares/auth';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

let authMiddleware: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;

function createResponseMock() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  ({ authMiddleware } = await import('../../src/middlewares/auth'));
});

describe('authMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 para token expirado sem log de erro', async () => {
    const expiredToken = jwt.sign(
      { id: 1, role: 'client', token_version: 1 },
      process.env.JWT_SECRET!,
      { expiresIn: '-1s' },
    );
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = { headers: { authorization: `Bearer ${expiredToken}` } } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido.' });
    expect(next).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('continua logando outros erros de autenticação', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = { headers: { authorization: 'Bearer invalid-token' } } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token inválido.' });
    expect(next).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('rejeita JWT existente quando a conta está em processo de exclusão', async () => {
    const token = jwt.sign(
      { id: 1, role: 'client', token_version: 1 },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );
    queryMock.mockResolvedValueOnce([[
      { id: 1, token_version: 1, deletion_requested_at: new Date(), cpf: null, cpf_ciphertext: null },
    ]]);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      code: 'ACCOUNT_DELETION_PENDING',
      error: 'Esta conta está em processo de exclusão.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('permite JWT de usuário sem solicitação de exclusão', async () => {
    const token = jwt.sign(
      { id: 1, role: 'client', token_version: 1 },
      process.env.JWT_SECRET!,
      { expiresIn: '1h' },
    );
    queryMock.mockResolvedValueOnce([[
      { id: 1, token_version: 1, deletion_requested_at: null, cpf: null, cpf_ciphertext: null },
    ]]);
    const req = { headers: { authorization: `Bearer ${token}` } } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    await authMiddleware(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });
});
