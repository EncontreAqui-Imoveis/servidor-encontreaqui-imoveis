import type { Request, Response } from 'express';

jest.mock('../../../../src/database/connection', () => ({
  __esModule: true,
  default: {
    execute: jest.fn(),
    query: jest.fn(),
  },
}));

import { negotiationController } from '../../../../src/controllers/NegotiationController';
import { NegotiationDocumentsRepository } from '../../../../src/modules/negotiations/infra/NegotiationDocumentsRepository';

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
  send: jest.Mock;
  setHeader: jest.Mock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};

  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();

  return res as MockResponse;
}

describe('NegotiationController.downloadDocument', () => {
  it('should set PDF headers and send buffer when document exists', async () => {
    const fileContent = Buffer.from('fake-pdf');
    jest.spyOn(NegotiationDocumentsRepository.prototype, 'findById').mockResolvedValue({
      fileContent,
      type: 'proposal',
    });

    const req = {
      params: {
        id: 'neg-1',
        documentId: '123',
      },
    } as unknown as Request;
    const res = createMockResponse();

    await negotiationController.downloadDocument(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="document_123.pdf"'
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', fileContent.length.toString());
    expect(res.send).toHaveBeenCalledWith(fileContent);
  });

  it('should return 404 when document is not found', async () => {
    jest.spyOn(NegotiationDocumentsRepository.prototype, 'findById').mockResolvedValue(null);

    const req = {
      params: {
        id: 'neg-1',
        documentId: '123',
      },
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
