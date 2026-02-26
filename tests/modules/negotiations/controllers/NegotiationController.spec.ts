import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

vi.mock('../../../../src/database/connection', () => ({
  __esModule: true,
  default: {
    execute: vi.fn(),
    query: vi.fn(),
  },
}));

import { negotiationController } from '../../../../src/controllers/NegotiationController';
import connection from '../../../../src/database/connection';
import { NegotiationDocumentsRepository } from '../../../../src/modules/negotiations/infra/NegotiationDocumentsRepository';

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
  send: FnMock;
  setHeader: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};

  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();

  return res as MockResponse;
}

describe('NegotiationController.downloadDocument', () => {
  it('should set PDF headers and send buffer when document exists', async () => {
    vi.mocked(connection.query).mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          capturing_broker_id: 55,
          selling_broker_id: null,
          buyer_client_id: null,
        },
      ],
      {},
    ] as any);

    const fileContent = Buffer.from('fake-pdf');
    vi.spyOn(NegotiationDocumentsRepository.prototype, 'findById').mockResolvedValue({
      negotiationId: 'neg-1',
      fileContent,
      type: 'proposal',
      documentType: 'proposal',
      metadataJson: {},
    });

    const req = {
      params: {
        id: 'neg-1',
        documentId: '123',
      },
      userId: 55,
      userRole: 'broker',
    } as unknown as Request;
    const res = createMockResponse();

    await negotiationController.downloadDocument(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="proposal_123.pdf"; filename*=UTF-8\'\'proposal_123.pdf'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', fileContent.length.toString());
    expect(res.send).toHaveBeenCalledWith(fileContent);
  });

  it('should return 404 when document is not found', async () => {
    vi.mocked(connection.query).mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          capturing_broker_id: 55,
          selling_broker_id: null,
          buyer_client_id: null,
        },
      ],
      {},
    ] as any);

    vi.spyOn(NegotiationDocumentsRepository.prototype, 'findById').mockResolvedValue(null);

    const req = {
      params: {
        id: 'neg-1',
        documentId: '123',
      },
      userId: 55,
      userRole: 'broker',
    } as unknown as Request;
    const res = createMockResponse();

    await negotiationController.downloadDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
      })
    );
  });
});
