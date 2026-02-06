import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Response } from 'express';

import type { AuthRequest } from './auth';

let isClient: (req: AuthRequest, res: Response, next: NextFunction) => void;
let isAdmin: (req: AuthRequest, res: Response, next: NextFunction) => void;

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  ({ isClient, isAdmin } = await import('./auth'));
});

function createResponseMock() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

describe('isClient middleware', () => {
  it('permite quando role e client', () => {
    const req = { userRole: 'client' } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    isClient(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bloqueia quando role nao e client', () => {
    const req = { userRole: 'broker' } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    isClient(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(403);
  });
});

describe('isAdmin middleware', () => {
  it('permite quando role e admin', () => {
    const req = { userRole: 'admin' } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    isAdmin(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('bloqueia quando role nao e admin', () => {
    const req = { userRole: 'client' } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    isAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(403);
  });
});
