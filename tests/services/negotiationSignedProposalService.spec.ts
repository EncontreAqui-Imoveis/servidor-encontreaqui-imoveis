import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

const {
  txMock,
  getConnectionMock,
  queryMock,
  saveSignedProposalMock,
  createAdminNotificationMock,
  findLatestNegotiationDocumentByTypeMock,
  authState,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    txMock: tx,
    getConnectionMock: vi.fn(),
    queryMock: vi.fn(),
    saveSignedProposalMock: vi.fn(),
    createAdminNotificationMock: vi.fn(),
    findLatestNegotiationDocumentByTypeMock: vi.fn(),
    authState: {
      userId: 30003,
      userRole: 'broker',
    },
  };
});

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  getNegotiationDbConnection: getConnectionMock,
  queryNegotiationRows: queryMock,
  findLatestNegotiationDocumentByType: findLatestNegotiationDocumentByTypeMock,
  saveNegotiationSignedProposalDocument: saveSignedProposalMock,
  findNegotiationDocumentById: vi.fn(),
  generateNegotiationProposalPdf: vi.fn(),
  saveNegotiationProposalDocument: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
}));

import {
  downloadLatestProposal,
  uploadSignedProposal,
} from '../../src/services/negotiationSignedProposalService';

type FnMock = ReturnType<typeof vi.fn>;

function createMockResponse(): Response & {
  status: FnMock;
  json: FnMock;
  end: FnMock;
  setHeader: FnMock;
} {
  const res: Partial<Response> & Record<string, any> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res as any;
}

describe('negotiationSignedProposalService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.userId = 30003;
    authState.userRole = 'broker';
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.execute.mockResolvedValue({ affectedRows: 1 });
    saveSignedProposalMock.mockResolvedValue(70001);
    createAdminNotificationMock.mockResolvedValue(undefined);
  });

  it('uploads signed proposal, updates negotiation and notifies admins', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 101,
          status: 'PROPOSAL_SENT',
          capturing_broker_id: 30003,
          selling_broker_id: 30003,
          buyer_client_id: null,
          property_title: 'Casa Teste',
          broker_name: 'Pedro Corretor',
        },
      ],
    ]);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
      file: {
        buffer: Buffer.from('%PDF-signed%'),
        mimetype: 'application/pdf',
        originalname: 'proposta_assinada.pdf',
      },
    } as any;
    const res = createMockResponse();

    await uploadSignedProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(saveSignedProposalMock).toHaveBeenCalledWith(
      'neg-1',
      expect.any(Buffer),
      txMock,
      expect.objectContaining({
        originalFileName: 'proposta_assinada.pdf',
        uploadedBy: 30003,
      })
    );
    expect(createAdminNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        relatedEntityId: 101,
        metadata: expect.objectContaining({
          negotiationId: 'neg-1',
          propertyId: 101,
          brokerId: 30003,
          documentId: 70001,
        }),
      })
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('downloads latest proposal when document exists', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 30003,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: null,
      },
    ]);
    findLatestNegotiationDocumentByTypeMock.mockResolvedValueOnce({
      id: 987,
      negotiationId: 'neg-1',
      fileContent: Buffer.from('%PDF-proposal%'),
      type: 'proposal',
      documentType: 'proposal',
      metadataJson: {},
    });

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
    } as any;
    const res = createMockResponse();

    await downloadLatestProposal(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('X-Document-Id', '987');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF-proposal%'));
  });

  it('returns 400 when uploaded file is not a PDF', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 101,
          status: 'PROPOSAL_SENT',
          capturing_broker_id: 30003,
          selling_broker_id: 30003,
          buyer_client_id: null,
          property_title: 'Casa Teste',
          broker_name: 'Pedro Corretor',
        },
      ],
    ]);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
      file: {
        buffer: Buffer.from('%PDF-signed%'),
        mimetype: 'image/png',
        originalname: 'proposta_assinada.png',
      },
    } as any;
    const res = createMockResponse();

    await uploadSignedProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(saveSignedProposalMock).not.toHaveBeenCalled();
    expect(txMock.commit).not.toHaveBeenCalled();
  });

  it('returns 403 when user is not part of negotiation', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 101,
          status: 'PROPOSAL_SENT',
          capturing_broker_id: 30003,
          selling_broker_id: 30003,
          buyer_client_id: null,
          property_title: 'Casa Teste',
          broker_name: 'Pedro Corretor',
        },
      ],
    ]);

    const req = {
      userId: 99999,
      userRole: 'client',
      params: { id: 'neg-1' },
      file: {
        buffer: Buffer.from('%PDF-signed%'),
        mimetype: 'application/pdf',
        originalname: 'proposta_assinada.pdf',
      },
    } as any;
    const res = createMockResponse();

    await uploadSignedProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(saveSignedProposalMock).not.toHaveBeenCalled();
    expect(txMock.commit).not.toHaveBeenCalled();
  });

  it('returns 404 when no latest proposal exists', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'neg-1',
        capturing_broker_id: 30003,
        selling_broker_id: null,
        seller_client_id: null,
        buyer_client_id: null,
      },
    ]);
    findLatestNegotiationDocumentByTypeMock.mockResolvedValueOnce(null);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
    } as any;
    const res = createMockResponse();

    await downloadLatestProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Nenhuma proposta encontrada'),
      })
    );
  });
});
