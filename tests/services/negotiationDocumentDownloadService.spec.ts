import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: vi.fn(),
  findNegotiationDocumentById: vi.fn(),
}));

import { downloadDocument } from '../../src/services/negotiationDocumentDownloadService';
import {
  findNegotiationDocumentById,
  queryNegotiationRows,
} from '../../src/services/negotiationPersistenceService';

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
  end: FnMock;
  setHeader: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res as MockResponse;
}

describe('negotiationDocumentDownloadService.downloadDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads document when user owns negotiation', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 10,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: null,
      },
    ] as any);

    const fileContent = Buffer.from('document-bytes');
    vi.mocked(findNegotiationDocumentById).mockResolvedValueOnce({
      id: 99,
      negotiationId: 'neg-1',
      fileContent,
      type: 'proposal',
      documentType: 'proposal',
      metadataJson: { originalFileName: 'Minha proposta final.pdf' },
    } as any);

    const req = {
      params: {
        id: 'neg-1',
        documentId: '99',
      },
      userId: 10,
      userRole: 'broker',
    } as any;
    const res = createMockResponse();

    await downloadDocument(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="Minha proposta final.pdf"; filename*=UTF-8\'\'Minha%20proposta%20final.pdf'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', String(fileContent.length));
    expect(res.end).toHaveBeenCalledWith(fileContent);
  });

  it('returns 403 when user does not own negotiation', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 10,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: null,
      },
    ] as any);

    const req = {
      params: {
        id: 'neg-1',
        documentId: '99',
      },
      userId: 11,
      userRole: 'broker',
    } as any;
    const res = createMockResponse();

    await downloadDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Acesso negado ao documento.' })
    );
    expect(findNegotiationDocumentById).not.toHaveBeenCalled();
  });

  it('returns 404 when document does not exist', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 10,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: null,
      },
    ] as any);
    vi.mocked(findNegotiationDocumentById).mockResolvedValueOnce(null);

    const req = {
      params: {
        id: 'neg-1',
        documentId: '99',
      },
      userId: 10,
      userRole: 'broker',
    } as any;
    const res = createMockResponse();

    await downloadDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Documento nao encontrado.' })
    );
  });

  it('returns 404 when document belongs to another negotiation', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 10,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: null,
      },
    ] as any);
    vi.mocked(findNegotiationDocumentById).mockResolvedValueOnce({
      id: 99,
      negotiationId: 'neg-2',
      fileContent: Buffer.from('document-bytes'),
      type: 'proposal',
      documentType: 'proposal',
      metadataJson: {},
    } as any);

    const req = {
      params: {
        id: 'neg-1',
        documentId: '99',
      },
      userId: 10,
      userRole: 'broker',
    } as any;
    const res = createMockResponse();

    await downloadDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Documento nao encontrado.' })
    );
  });
});
