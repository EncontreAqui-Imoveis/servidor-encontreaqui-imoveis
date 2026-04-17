import type { NextFunction, Response } from 'express';
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

let isBroker: (req: AuthRequest, res: Response, next: NextFunction) => Promise<void>;

beforeAll(async () => {
  process.env.JWT_SECRET ??= 'test-secret';
  ({ isBroker } = await import('../../src/middlewares/auth'));
});

function createResponseMock() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json } as unknown as Response;
}

describe('isBroker middleware guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies broker access when broker row no longer exists', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    const req = { userId: 77, userRole: 'broker' } as AuthRequest;
    const res = createResponseMock();
    const next = vi.fn();

    await isBroker(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect((res as any).status).toHaveBeenCalledWith(403);
    expect(
      queryMock.mock.calls.some((call) => String(call[0]).includes('INSERT IGNORE INTO brokers')),
    ).toBe(false);
  });
});
