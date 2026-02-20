import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findByIdMock } = vi.hoisted(() => ({
  findByIdMock: vi.fn(),
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 30003;
    req.userRole = 'broker';
    next();
  },
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    execute: vi.fn(),
    query: vi.fn(),
    getConnection: vi.fn(),
  },
}));

vi.mock('../../src/modules/negotiations/infra/NegotiationDocumentsRepository', () => ({
  NegotiationDocumentsRepository: class {
    findById = findByIdMock;
    saveProposal = vi.fn();
    saveSignedProposal = vi.fn();
    findLatestByNegotiationAndType = vi.fn();
  },
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('GET /negotiations/:id/documents/:documentId/download headers', () => {
  const app = express();
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Content-Disposition with attachment and original filename', async () => {
    findByIdMock.mockResolvedValue({
      fileContent: Buffer.from('%PDF-1.4 fake pdf'),
      type: 'contract',
      documentType: 'contrato_assinado',
      metadataJson: {
        originalFileName: 'contrato_final_assinado.pdf',
      },
    });

    const response = await request(app).get(
      '/negotiations/neg-1/documents/987/download'
    );

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-disposition']).toContain(
      'filename="contrato_final_assinado.pdf"'
    );
  });
});
