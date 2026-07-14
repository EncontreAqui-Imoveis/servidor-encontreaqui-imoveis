import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryNegotiationRowsMock, findNegotiationDocumentByIdMock } = vi.hoisted(() => ({
  queryNegotiationRowsMock: vi.fn(),
  findNegotiationDocumentByIdMock: vi.fn(),
}));

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: queryNegotiationRowsMock,
  findNegotiationDocumentById: findNegotiationDocumentByIdMock,
}));

import { downloadDocument } from '../../src/services/negotiationDocumentDownloadService';

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    setHeader: vi.fn(),
    end: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

describe('negotiationDocumentDownloadService legal buyer handshake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the linked buyer to download only after PIN verification', async () => {
    queryNegotiationRowsMock.mockResolvedValueOnce([{
      id: 'neg-1',
      proposer_id: 10,
      advertiser_id: 11,
      legal_buyer_user_id: 20,
      handshake_pin: 'a'.repeat(64),
      handshake_status: 'VERIFIED',
    }]);
    findNegotiationDocumentByIdMock.mockResolvedValueOnce({
      id: 4,
      negotiationId: 'neg-1',
      fileContent: Buffer.from('%PDF-1.4'),
      type: 'contract',
      documentType: 'contrato_minuta',
      metadataJson: {},
    });
    const response = createResponse();

    await downloadDocument({
      params: { id: 'neg-1', documentId: '4' },
      userId: 20,
      userRole: 'client',
    } as any, response as any);

    expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(response.end).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'));
  });

  it('denies a pending linked buyer before reading the document', async () => {
    queryNegotiationRowsMock.mockResolvedValueOnce([{
      id: 'neg-1',
      proposer_id: 10,
      advertiser_id: 11,
      legal_buyer_user_id: 20,
      handshake_pin: 'a'.repeat(64),
      handshake_status: 'PENDING',
    }]);
    const response = createResponse();

    await downloadDocument({
      params: { id: 'neg-1', documentId: '4' },
      userId: 20,
      userRole: 'client',
    } as any, response as any);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(findNegotiationDocumentByIdMock).not.toHaveBeenCalled();
  });
});
