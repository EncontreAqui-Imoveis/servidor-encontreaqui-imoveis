import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

const {
  getConnectionMock,
  txMock,
  generateNegotiationProposalPdfMock,
  saveNegotiationProposalDocumentMock,
  parseProposalWizardBodyMock,
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
    getConnectionMock: vi.fn(),
    txMock: tx,
    generateNegotiationProposalPdfMock: vi.fn(),
    saveNegotiationProposalDocumentMock: vi.fn(),
    parseProposalWizardBodyMock: vi.fn(),
  };
});

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  getNegotiationDbConnection: getConnectionMock,
  generateNegotiationProposalPdf: generateNegotiationProposalPdfMock,
  saveNegotiationProposalDocument: saveNegotiationProposalDocumentMock,
}));

vi.mock('../../src/services/negotiationProposalSupportService', () => ({
  parseProposalWizardBody: parseProposalWizardBodyMock,
  assertProposalValidityDateNotPast: vi.fn(),
  buildProposalValidityDate: vi.fn().mockReturnValue('2026-06-30 10:00:00'),
  normalizeOptionalPositiveId: vi.fn((value: unknown) => Number(value)),
  normalizeProposalCpfKey: vi.fn((value: unknown) =>
    String(value ?? '').replace(/\D/g, '')
  ),
  resolvePropertyAddress: vi.fn(() => 'Rua A, 100'),
  resolvePropertyValue: vi.fn(() => 500000),
  toCents: vi.fn((value: unknown) => Math.round(Number(value) * 100)),
}));

import { updateProposalFromWizard, deleteMyProposal } from '../../src/services/negotiationProposalMutationService';

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

describe('negotiationProposalMutationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.execute.mockResolvedValue({ affectedRows: 1 });
    generateNegotiationProposalPdfMock.mockResolvedValue(Buffer.from('%PDF-proposal%'));
    saveNegotiationProposalDocumentMock.mockResolvedValue(9001);
    parseProposalWizardBodyMock.mockReturnValue({
      propertyId: 101,
      clientName: 'Maria Cliente',
      clientCpf: '52998224725',
      validadeDias: 10,
      pagamento: {
        dinheiro: 500000,
        permuta: 0,
        financiamento: 0,
        outros: 0,
      },
    });
  });

  it('atualiza proposta do wizard e retorna PDF gerado', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            property_id: 101,
            status: 'PROPOSAL_DRAFT',
            capturing_broker_id: 30003,
            selling_broker_id: 30003,
            buyer_client_id: null,
            last_draft_edit_at: null,
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          { c: 0 },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 101,
            broker_id: 30003,
            owner_id: 40004,
            status: 'approved',
            address: 'Rua A',
            numero: '100',
            quadra: null,
            lote: null,
            bairro: 'Centro',
            city: 'Rio Verde',
            state: 'GO',
            price: 500000,
            price_sale: 500000,
            price_rent: null,
          },
        ],
      ])
      .mockResolvedValueOnce([[]]);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProposalFromWizard(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-proposal%'));
    expect(saveNegotiationProposalDocumentMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      txMock,
      expect.objectContaining({
        originalFileName: 'proposta.pdf',
        generated: true,
      })
    );
  });

  it('retorna 401 quando nao ha usuario autenticado', async () => {
    const req = {
      userId: undefined,
      userRole: 'broker',
      params: { id: 'neg-1' },
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProposalFromWizard(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(parseProposalWizardBodyMock).not.toHaveBeenCalled();
  });

  it('retorna 404 quando a negociacao nao existe', async () => {
    txMock.query.mockResolvedValueOnce([[]]);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-missing' },
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProposalFromWizard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(txMock.commit).not.toHaveBeenCalled();
    expect(txMock.execute).not.toHaveBeenCalled();
  });

  it('retorna 409 quando o imovel ainda nao foi aprovado', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            property_id: 101,
            status: 'PROPOSAL_DRAFT',
            capturing_broker_id: 30003,
            selling_broker_id: 30003,
            buyer_client_id: null,
            last_draft_edit_at: null,
          },
        ],
      ])
      .mockResolvedValueOnce([[{ c: 0 }]])
      .mockResolvedValueOnce([
        [
          {
            id: 101,
            broker_id: 30003,
            owner_id: 40004,
            status: 'draft',
            address: 'Rua A',
            numero: '100',
            quadra: null,
            lote: null,
            bairro: 'Centro',
            city: 'Rio Verde',
            state: 'GO',
            price: 500000,
            price_sale: 500000,
            price_rent: null,
          },
        ],
      ]);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
      body: {},
    } as any;
    const res = createMockResponse();

    await updateProposalFromWizard(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONFLICT',
      })
    );
    expect(generateNegotiationProposalPdfMock).not.toHaveBeenCalled();
    expect(saveNegotiationProposalDocumentMock).not.toHaveBeenCalled();
  });

  it('exclui proposta do usuario e retorna 204', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            capturing_broker_id: 30003,
            selling_broker_id: 30003,
            seller_client_id: null,
            buyer_client_id: null,
            status: 'PROPOSAL_SENT',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const req = {
      userId: 30003,
      userRole: 'broker',
      params: { id: 'neg-1' },
    } as any;
    const res = createMockResponse();

    await deleteMyProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('retorna 403 ao excluir proposta sem acesso', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          capturing_broker_id: 30003,
          selling_broker_id: 30003,
          seller_client_id: null,
          buyer_client_id: null,
          status: 'PROPOSAL_SENT',
        },
      ],
    ]);

    const req = {
      userId: 99999,
      userRole: 'client',
      params: { id: 'neg-1' },
    } as any;
    const res = createMockResponse();

    await deleteMyProposal(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(txMock.commit).not.toHaveBeenCalled();
  });
});
