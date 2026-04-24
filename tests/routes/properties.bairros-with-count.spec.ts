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

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(),
      generateEmailVerificationLink: vi.fn(),
      createUser: vi.fn(),
      getUserByEmail: vi.fn(),
      updateUser: vi.fn(),
    }),
  },
}));

describe('GET /properties/bairros', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();

    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.includes('FROM properties p') && normalizedSql.includes('GROUP BY p.bairro, p.city')) {
        expect(params).toEqual([
          '%Rio Verde%',
          'DOCUMENTATION_PHASE',
          'IN_NEGOTIATION',
          'CONTRACT_DRAFTING',
          'AWAITING_SIGNATURES',
          'SOLD',
          'RENTED',
        ]);

        return [[{ bairro: 'Jardim América', city: 'Rio Verde', total: 2 }], []] as const;
      }

      return [[], []] as const;
    });
  });

  it('binds city before blocking statuses and returns bairros for the selected city', async () => {
    const response = await request(app).get('/properties/bairros').query({ city: 'Rio Verde' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      { bairro: 'Jardim América', city: 'Rio Verde', total: 2 },
    ]);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});
