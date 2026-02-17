import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  txMock,
  getConnectionMock,
  generateProposalMock,
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
    generateProposalMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    execute: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 30003;
    req.userRole = 'broker';
    next();
  },
}));

vi.mock('../../src/modules/negotiations/infra/ExternalPdfService', () => ({
  ExternalPdfService: class MockExternalPdfService {
    generateProposal = generateProposalMock;
  },
}));

import negotiationRoutes from '../../src/routes/negotiation.routes';

describe('POST /negotiations/proposal', () => {
  const app = express();
  app.use(express.json());
  app.use('/negotiations', negotiationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.execute.mockResolvedValue({ insertId: 91001 });
    generateProposalMock.mockResolvedValue(Buffer.from('%PDF-fake-proposal%'));
  });

  it('persists negotiation as waiting signature and returns generated PDF', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 101,
            address: 'Av. Paulista, 1000',
            numero: '1000',
            quadra: 'Q1',
            lote: 'L2',
            bairro: 'Bela Vista',
            city: 'Sao Paulo',
            state: 'SP',
            price: 500000,
            price_sale: 500000,
            price_rent: null,
          },
        ],
      ])
      .mockResolvedValueOnce([[{ name: 'Broker Teste' }]])
      .mockResolvedValueOnce([[]]);

    const response = await request(app).post('/negotiations/proposal').send({
      propertyId: 101,
      clientName: 'Joao da Silva',
      clientCpf: '111.222.333-44',
      validadeDias: 10,
      pagamento: {
        dinheiro: 100000,
        permuta: 0,
        financiamento: 400000,
        outros: 0,
      },
    });

    expect(response.status).toBe(201);
    expect(response.header['content-type']).toContain('application/pdf');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(txMock.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO negotiations'),
      expect.arrayContaining([expect.any(String), 101, 30003, 30003, 'AWAITING_SIGNATURES'])
    );
    expect(generateProposalMock).toHaveBeenCalledTimes(1);
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('rejects proposal when payment math does not match property value', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 101,
          address: 'Av. Paulista, 1000',
          numero: '1000',
          quadra: null,
          lote: null,
          bairro: 'Bela Vista',
          city: 'Sao Paulo',
          state: 'SP',
          price: 500000,
          price_sale: 500000,
          price_rent: null,
        },
      ],
    ]);

    const response = await request(app).post('/negotiations/proposal').send({
      propertyId: 101,
      clientName: 'Joao da Silva',
      clientCpf: '111.222.333-44',
      validadeDias: 10,
      pagamento: {
        dinheiro: 100000,
        permuta: 0,
        financiamento: 300000,
        outros: 0,
      },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('A soma dos pagamentos');
    expect(txMock.rollback).toHaveBeenCalledTimes(1);
    expect(txMock.execute).not.toHaveBeenCalled();
    expect(generateProposalMock).not.toHaveBeenCalled();
  });
});
