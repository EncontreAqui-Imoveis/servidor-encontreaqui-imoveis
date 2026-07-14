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
    req.userRole = 'client';
    next();
  },
  isBroker: (_req: any, _res: any, next: any) => next(),
  isClient: (_req: any, _res: any, next: any) => next(),
  isAdmin: (_req: any, _res: any, next: any) => next(),
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('GET /negotiations/proposal/conflict', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not disclose proposal conflicts through CPF lookup', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 90001,
          property_title: 'Casa Região Norte',
          status: 'PROPOSAL_SENT',
          client_name: 'Cliente',
          created_at: '2026-07-04T10:58:19.000Z',
          updated_at: '2026-07-04T10:58:19.000Z',
        },
      ],
    ]);

    const response = await request(app)
      .get('/negotiations/proposal/conflict')
      .query({ propertyId: 90001, cpf: '091.694.431-06' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ found: false, conflict: null });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid property id', async () => {
    const response = await request(app)
      .get('/negotiations/proposal/conflict')
      .query({ propertyId: '0', cpf: '09169443106' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('propertyId inválido');
    expect(queryMock).not.toHaveBeenCalled();
  });
});
