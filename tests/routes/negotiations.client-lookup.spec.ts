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

  it('orders by updated_at when the column exists', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'client_name' },
          { column_name: 'client_cpf' },
          { column_name: 'updated_at' },
          { column_name: 'created_at' },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            client_name: 'Cliente 1',
            client_cpf: '52998224725',
            client_phone: '64999990000',
          },
        ],
      ]);

    const response = await request(app)
      .get('/negotiations/client-lookup')
      .query({ cpf: '529.982.247-25' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      found: true,
      clientName: 'Cliente 1',
      clientPhone: '64999990000',
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const sql = String(queryMock.mock.calls[1]?.[0] ?? '');
    expect(sql).toContain('ORDER BY n.updated_at DESC');
    expect(sql).toContain('n.id DESC');
  });

  it('falls back to created_at when updated_at is unavailable', async () => {
    queryMock
      .mockResolvedValueOnce([
        [
          { column_name: 'client_name' },
          { column_name: 'client_cpf' },
          { column_name: 'created_at' },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            client_name: 'Cliente 2',
            client_cpf: '52998224725',
            client_phone: '64999990000',
          },
        ],
      ]);

    const response = await request(app)
      .get('/negotiations/client-lookup')
      .query({ cpf: '52998224725' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      found: true,
      clientName: 'Cliente 2',
      clientPhone: '64999990000',
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const sql = String(queryMock.mock.calls[1]?.[0] ?? '');
    expect(sql).not.toContain('n.updated_at DESC');
    expect(sql).toContain('n.created_at DESC');
    expect(sql).toContain('n.id DESC');
  });
});
