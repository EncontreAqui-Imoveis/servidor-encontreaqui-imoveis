import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  txMock,
  getConnectionMock,
  findNegotiationDocumentByIdMock,
  generateProposalMock,
  saveNegotiationDocumentMock,
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
    findNegotiationDocumentByIdMock: vi.fn(),
    generateProposalMock: vi.fn(),
    saveNegotiationDocumentMock: vi.fn(),
    authState: {
      userId: 30003,
      userRole: 'broker',
    },
  };
});

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  getNegotiationDbConnection: getConnectionMock,
  findNegotiationDocumentById: findNegotiationDocumentByIdMock,
  generateNegotiationProposalPdf: generateProposalMock,
  saveNegotiationProposalDocument: saveNegotiationDocumentMock,
}));

vi.mock('../../src/middlewares/requestContext', () => ({
  getRequestId: () => 'req-123',
}));

import { generateProposalFromProperty } from '../../src/services/negotiationProposalGenerationService';

describe('negotiationProposalGenerationService.generateProposalFromProperty', () => {
  const app = express();
  app.use(express.json());
  app.post('/negotiations/proposal', (req, res) => {
    req.userId = authState.userId;
    req.userRole = authState.userRole;
    return generateProposalFromProperty(req as any, res);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.userId = 30003;
    authState.userRole = 'broker';
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.execute.mockResolvedValue({ insertId: 91001 });
    generateProposalMock.mockResolvedValue(Buffer.from('%PDF-fake-proposal%'));
    saveNegotiationDocumentMock.mockResolvedValue(91001);
    findNegotiationDocumentByIdMock.mockResolvedValue(null);
  });

  it('replays an existing proposal when idempotency is complete', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 1,
          negotiation_id: 'neg-1',
          document_id: 91001,
        },
      ],
    ]);
    findNegotiationDocumentByIdMock.mockResolvedValueOnce({
      negotiationId: 'neg-1',
      fileContent: Buffer.from('%PDF-replayed%'),
    });

    const response = await request(app)
      .post('/negotiations/proposal')
      .set('Idempotency-Key', 'proposal-key-replay')
      .send({
        propertyId: 101,
        clientName: 'Joao da Silva',
        clientCpf: '529.982.247-25',
        validadeDias: 10,
        pagamento: {
          dinheiro: 100000,
          permuta: 0,
          financiamento: 400000,
          outros: 0,
        },
      });

    expect(response.status).toBe(200);
    expect(response.headers['x-idempotent-replay']).toBe('true');
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(txMock.commit).toHaveBeenCalledTimes(1);
    expect(txMock.rollback).not.toHaveBeenCalled();
    expect(txMock.execute).not.toHaveBeenCalled();
    expect(generateProposalMock).not.toHaveBeenCalled();
    expect(saveNegotiationDocumentMock).not.toHaveBeenCalled();
  });

  it('returns in-progress when idempotency exists but document mismatch remains', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 1,
          negotiation_id: 'neg-1',
          document_id: 91001,
        },
      ],
    ]);
    findNegotiationDocumentByIdMock.mockResolvedValueOnce({
      negotiationId: 'different-negotiation',
      fileContent: Buffer.from('%PDF-stale%'),
    });

    const response = await request(app)
      .post('/negotiations/proposal')
      .set('Idempotency-Key', 'proposal-key-conflict')
      .send({
        propertyId: 101,
        clientName: 'Joao da Silva',
        clientCpf: '529.982.247-25',
        validadeDias: 10,
        pagamento: {
          dinheiro: 100000,
          permuta: 0,
          financiamento: 400000,
          outros: 0,
        },
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PROPOSAL_IN_PROGRESS');
    expect(response.body.retryable).toBe(true);
    expect(txMock.rollback).toHaveBeenCalledTimes(1);
    expect(txMock.commit).not.toHaveBeenCalled();
    expect(generateProposalMock).not.toHaveBeenCalled();
    expect(saveNegotiationDocumentMock).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    authState.userId = undefined as any;

    const response = await request(app)
      .post('/negotiations/proposal')
      .set('Idempotency-Key', 'proposal-key-unauth')
      .send({
        propertyId: 101,
        clientName: 'Joao da Silva',
        clientCpf: '529.982.247-25',
        validadeDias: 10,
        pagamento: {
          dinheiro: 100000,
          permuta: 0,
          financiamento: 400000,
          outros: 0,
        },
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Usuario nao autenticado.');
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it('returns 400 when idempotency key is missing', async () => {
    const response = await request(app).post('/negotiations/proposal').send({
      propertyId: 101,
      clientName: 'Joao da Silva',
      clientCpf: '529.982.247-25',
      validadeDias: 10,
      pagamento: {
        dinheiro: 100000,
        permuta: 0,
        financiamento: 400000,
        outros: 0,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PROPOSAL_VALIDATION_FAILED');
    expect(response.body.error).toContain('idempotency_key');
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it('returns 409 when property is not approved', async () => {
    txMock.query.mockResolvedValueOnce([[]]);
    txMock.query.mockResolvedValueOnce([
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

    const response = await request(app)
      .post('/negotiations/proposal')
      .set('Idempotency-Key', 'proposal-key-not-approved')
      .send({
        propertyId: 101,
        clientName: 'Joao da Silva',
        clientCpf: '529.982.247-25',
        validadeDias: 10,
        pagamento: {
          dinheiro: 100000,
          permuta: 0,
          financiamento: 400000,
          outros: 0,
        },
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('imóveis aprovados');
    expect(generateProposalMock).not.toHaveBeenCalled();
    expect(saveNegotiationDocumentMock).not.toHaveBeenCalled();
  });
});
