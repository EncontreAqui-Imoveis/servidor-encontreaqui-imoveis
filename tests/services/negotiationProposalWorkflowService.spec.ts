import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

vi.mock('../../src/services/negotiationProposalSupportService', () => ({
  parseProposalData: vi.fn(),
}));

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  queryNegotiationRows: vi.fn(),
  executeNegotiationStatement: vi.fn(),
  generateNegotiationProposalPdf: vi.fn(),
  saveNegotiationProposalDocument: vi.fn(),
}));

vi.mock('../../src/modules/negotiations/infra/PdfQueue', () => ({
  addPdfJob: vi.fn(),
}));

import { generateProposal } from '../../src/services/negotiationProposalWorkflowService';
import { parseProposalData } from '../../src/services/negotiationProposalSupportService';
import {
  executeNegotiationStatement,
  generateNegotiationProposalPdf,
  queryNegotiationRows,
  saveNegotiationProposalDocument,
} from '../../src/services/negotiationPersistenceService';
import { addPdfJob } from '../../src/modules/negotiations/infra/PdfQueue';

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as MockResponse;
}

describe('negotiationProposalWorkflowService.generateProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseProposalData).mockReturnValue({
      clientName: 'Joao da Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 100',
      brokerName: 'Broker Teste',
      sellingBrokerName: 'Broker Teste',
      value: 500000,
      paymentMethod: 'cash',
      payment: { cash: 500000, tradeIn: 0, financing: 0, others: 0 },
      validityDays: 10,
      proposalValidityDate: null,
    } as any);
  });

  it('returns 202 when pdf queue accepts job', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([{ id: 'neg-1', status: 'approved' }] as any);
    vi.mocked(addPdfJob).mockResolvedValueOnce(undefined as any);

    const req = {
      params: { id: 'neg-1' },
      userId: 30003,
      body: { any: 'payload' },
    } as any;
    const res = createMockResponse();

    await generateProposal(req, res);

    expect(parseProposalData).toHaveBeenCalledTimes(1);
    expect(executeNegotiationStatement).toHaveBeenCalledTimes(1);
    expect(addPdfJob).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('segundo plano'),
        negotiationId: 'neg-1',
      })
    );
  });

  it('falls back to sync generation when queue is disabled', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([{ id: 'neg-1', status: 'approved' }] as any);
    vi.mocked(addPdfJob).mockRejectedValueOnce({ code: 'PDF_QUEUE_DISABLED', message: 'queue disabled' });
    vi.mocked(generateNegotiationProposalPdf).mockResolvedValueOnce(Buffer.from('%PDF-fallback'));
    vi.mocked(saveNegotiationProposalDocument).mockResolvedValueOnce(812 as any);

    const req = {
      params: { id: 'neg-1' },
      userId: 30003,
      body: { any: 'payload' },
    } as any;
    const res = createMockResponse();

    await generateProposal(req, res);

    expect(generateNegotiationProposalPdf).toHaveBeenCalledTimes(1);
    expect(saveNegotiationProposalDocument).toHaveBeenCalledWith(
      'neg-1',
      expect.any(Buffer),
      null,
      expect.objectContaining({
        originalFileName: 'proposta.pdf',
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('síncrona'),
        negotiationId: 'neg-1',
      })
    );
  });

  it('maps dependency failures during fallback to 503', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([{ id: 'neg-1', status: 'approved' }] as any);
    vi.mocked(addPdfJob).mockRejectedValueOnce({ code: 'PDF_QUEUE_DISABLED', message: 'queue disabled' });
    vi.mocked(generateNegotiationProposalPdf).mockRejectedValueOnce(
      new Error('PDF_INTERNAL_API_KEY nao configurado')
    );

    const req = {
      params: { id: 'neg-1' },
      userId: 30003,
      body: { any: 'payload' },
    } as any;
    const res = createMockResponse();

    await generateProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      })
    );
  });

  it('returns 404 when negotiation does not exist', async () => {
    vi.mocked(queryNegotiationRows).mockResolvedValueOnce([] as any);

    const req = {
      params: { id: 'neg-missing' },
      userId: 30003,
      body: { any: 'payload' },
    } as any;
    const res = createMockResponse();

    await generateProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Negociacao nao encontrada.',
      })
    );
  });

  it('returns 401 when user is not authenticated', async () => {
    const req = {
      params: { id: 'neg-1' },
      userId: undefined,
      body: { any: 'payload' },
    } as any;
    const res = createMockResponse();

    await generateProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(parseProposalData).not.toHaveBeenCalled();
    expect(queryNegotiationRows).not.toHaveBeenCalled();
  });

  it('returns 400 when proposal payload is invalid', async () => {
    vi.mocked(parseProposalData).mockImplementationOnce(() => {
      throw new Error('payload inválido');
    });

    const req = {
      params: { id: 'neg-1' },
      userId: 30003,
      body: { any: 'payload' },
    } as any;
    const res = createMockResponse();

    await generateProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'payload inválido' });
    expect(queryNegotiationRows).not.toHaveBeenCalled();
  });
});
