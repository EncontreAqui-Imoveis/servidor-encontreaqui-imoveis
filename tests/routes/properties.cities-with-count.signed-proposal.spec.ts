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

describe('GET /properties/cities-with-count after proposal signature', () => {
  let app: express.Express;
  let isProposalSigned = false;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: propertyRoutes } = await import('../../src/routes/property.routes');
    app = express();
    app.use(express.json());
    app.use('/properties', propertyRoutes);
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    isProposalSigned = false;

    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.includes('FROM properties p') && normalizedSql.includes('GROUP BY p.city')) {
        const blockingStatuses = (params ?? []).map((item) => String(item));
        // PROPOSAL_SENT deve permanecer fora do bloqueio para manter vitrine antes da assinatura.
        expect(blockingStatuses).not.toContain('PROPOSAL_SENT');
        expect(blockingStatuses).toContain('IN_NEGOTIATION');

        const total = isProposalSigned ? 0 : 1;
        const rows = total > 0 ? [{ city: 'Goiânia', total }] : [];
        return [rows, []] as const;
      }

      return [[], []] as const;
    });
  });

  it('decrements city count immediately after proposal turns into blocking status', async () => {
    const beforeSigned = await request(app).get('/properties/cities-with-count');

    expect(beforeSigned.status).toBe(200);
    expect(beforeSigned.body).toEqual([{ city: 'Goiânia', total: 1 }]);

    // Simula transição de proposta assinada para status que bloqueia vitrine pública.
    isProposalSigned = true;

    const afterSigned = await request(app).get('/properties/cities-with-count');

    expect(afterSigned.status).toBe(200);
    expect(afterSigned.body).toEqual([]);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
