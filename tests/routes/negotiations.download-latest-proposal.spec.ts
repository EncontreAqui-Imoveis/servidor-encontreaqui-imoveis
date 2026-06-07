import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, findLatestNegotiationDocumentByTypeMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  findLatestNegotiationDocumentByTypeMock: vi.fn(),
}));

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: queryMock,
  findLatestNegotiationDocumentByType: findLatestNegotiationDocumentByTypeMock,
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

describe('GET /negotiations/:id/proposals/download', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads the latest proposal for an owned negotiation', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 30003,
        selling_broker_id: 30003,
        seller_client_id: null,
        buyer_client_id: 40004,
      },
    ]);
    findLatestNegotiationDocumentByTypeMock.mockResolvedValueOnce({
      id: 99,
      negotiationId: 'neg-1',
      fileContent: Buffer.from('%PDF-proposal%'),
    });

    const response = await request(app).get('/negotiations/neg-1/proposals/download');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['x-document-id']).toBe('99');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body.toString()).toContain('%PDF-proposal%');
  });

  it('returns 403 when the broker does not own the negotiation', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 30004,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: 40004,
      },
    ]);

    const response = await request(app).get('/negotiations/neg-1/proposals/download');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Acesso negado à proposta.');
    expect(findLatestNegotiationDocumentByTypeMock).not.toHaveBeenCalled();
  });

  it('returns 404 when no proposal exists yet', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 30003,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: 40004,
      },
    ]);
    findLatestNegotiationDocumentByTypeMock.mockResolvedValueOnce(null);

    const response = await request(app).get('/negotiations/neg-1/proposals/download');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Nenhuma proposta encontrada para esta negociação.');
  });
});
