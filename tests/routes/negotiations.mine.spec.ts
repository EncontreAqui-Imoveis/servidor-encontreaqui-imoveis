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
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('GET /negotiations/mine', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the authenticated user negotiations in the site shape', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 60102,
          property_title: 'Casa Central',
          property_city: 'Rio Verde',
          property_state: 'GO',
          property_image: 'https://res.cloudinary.com/demo/image/upload/casa.jpg',
          status: 'DOCUMENTATION_PHASE',
          client_name: 'Cliente 1',
          client_cpf: '11122233344',
          proposal_validity_date: '2026-03-20 10:00:00',
          created_at: '2026-03-10 10:00:00',
          updated_at: '2026-03-11 12:00:00',
        },
      ],
    ]);

    const response = await request(app).get('/negotiations/mine');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: 'neg-1',
        propertyId: 60102,
        propertyTitle: 'Casa Central',
        propertyCity: 'Rio Verde',
        propertyState: 'GO',
        propertyImage: 'https://res.cloudinary.com/demo/image/upload/casa.jpg',
        status: 'DOCUMENTATION_PHASE',
        clientName: 'Cliente 1',
        clientCpf: '11122233344',
      }),
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
