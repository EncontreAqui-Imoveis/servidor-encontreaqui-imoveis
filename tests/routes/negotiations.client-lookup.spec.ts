import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    execute: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 30003;
    req.userRole = 'broker';
    next();
  },
  isBroker: (_req: any, _res: any, next: any) => next(),
  isClient: (_req: any, _res: any, next: any) => next(),
  isAdmin: (_req: any, _res: any, next: any) => next(),
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('GET /negotiations/client-lookup', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not expose account data through CPF lookup', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'client_name' },
          { column_name: 'updated_at' },
          { column_name: 'created_at' },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            client_name: 'Cliente 1',
            client_phone: '64999990000',
          },
        ],
      ]);

    const response = await request(app)
      .get('/negotiations/client-lookup')
      .query({ cpf: '529.982.247-25' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ found: false, clientName: null, clientPhone: null });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('keeps the compatibility endpoint neutral regardless of CPF format', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'client_name' },
          { column_name: 'created_at' },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            client_name: 'Cliente 2',
            client_phone: '64999990000',
          },
        ],
      ]);

    const response = await request(app)
      .get('/negotiations/client-lookup')
      .query({ cpf: '52998224725' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ found: false, clientName: null, clientPhone: null });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
