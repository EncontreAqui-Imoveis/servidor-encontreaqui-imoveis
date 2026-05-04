import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    getConnection: vi.fn(),
  },
}));

import { adminController } from '../../src/controllers/AdminController';

describe('GET /admin/brokers/pending', () => {
  const app = express();

  app.get('/admin/brokers/pending', (req, res) => {
    return adminController.listPendingBrokers(req, res);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([[], []]);
  });

  it('só busca corretores em análise com documentos reais', async () => {
    const response = await request(app).get('/admin/brokers/pending');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      data: [],
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [queryText] = queryMock.mock.calls[0] as [string];
    expect(queryText).toContain('INNER JOIN broker_documents bd');
    expect(queryText).toContain("bd.status IN ('pending', 'rejected')");
    expect(queryText).toContain('bd.creci_front_url IS NOT NULL');
    expect(queryText).toContain('bd.creci_back_url IS NOT NULL');
    expect(queryText).toContain('bd.selfie_url IS NOT NULL');
    expect(queryText).toContain("b.status = 'pending_verification'");
  });
});
