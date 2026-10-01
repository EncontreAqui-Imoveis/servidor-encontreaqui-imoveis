import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  findLatestNegotiationDocumentByTypeMock,
  findLatestSignedProposalDocumentMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  findLatestNegotiationDocumentByTypeMock: vi.fn(),
  findLatestSignedProposalDocumentMock: vi.fn(),
}));

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: queryMock,
  findLatestNegotiationDocumentByType: findLatestNegotiationDocumentByTypeMock,
  findLatestSignedProposalDocument: findLatestSignedProposalDocumentMock,
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
        proposer_id: 30003,
        advertiser_id: 40001,
      },
    ]).mockResolvedValueOnce([]);
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
        proposer_id: 30004,
        advertiser_id: 40001,
      },
    ]).mockResolvedValueOnce([]);

    const response = await request(app).get('/negotiations/neg-1/proposals/download');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Acesso negado à proposta.');
    expect(findLatestNegotiationDocumentByTypeMock).not.toHaveBeenCalled();
  });

  it('returns 404 when no proposal exists yet', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        proposer_id: 30003,
        advertiser_id: 40001,
      },
    ]);
    findLatestNegotiationDocumentByTypeMock.mockResolvedValueOnce(null);

    const response = await request(app).get('/negotiations/neg-1/proposals/download');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Nenhuma proposta encontrada para esta negociação.');
  });

  it('downloads the signed proposal from its dedicated endpoint', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        proposer_id: 30003,
        advertiser_id: 40001,
      },
    ]);
    findLatestSignedProposalDocumentMock.mockResolvedValueOnce({
      id: 101,
      fileContent: Buffer.from('%PDF-signed-proposal%'),
      type: 'other',
    });

    const response = await request(app).get(
      '/negotiations/neg-1/proposals/signed/download'
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('proposta_assinada.pdf');
    expect(response.headers['x-document-id']).toBe('101');
    expect(response.body.toString()).toContain('%PDF-signed-proposal%');
    expect(findLatestNegotiationDocumentByTypeMock).not.toHaveBeenCalled();
  });
});
