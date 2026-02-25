import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, generateProposalMock } = vi.hoisted(() => {
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

function expectedDateAfter(days: number): string {
  const target = new Date();
  target.setDate(target.getDate() + days);
  const yyyy = String(target.getFullYear()).padStart(4, '0');
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

describe('Contractual compliance: POST /negotiations/proposal', () => {
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
    txMock.execute.mockResolvedValue({ insertId: 92001 });
    generateProposalMock.mockResolvedValue(Buffer.from('%PDF-proposal%'));
  });

  it('persists proposal_validity_date (+10d) and ignores tampered property value from payload', async () => {
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
      .mockResolvedValueOnce([[{ name: 'Broker Contratual' }]])
      .mockResolvedValueOnce([[]]);

    const response = await request(app).post('/negotiations/proposal').send({
      propertyId: 101,
      clientName: 'Cliente Contratual',
      clientCpf: '111.222.333-44',
      validadeDias: 10,
      value: 1,
      price: 1,
      price_sale: 1,
      pagamento: {
        dinheiro: 100000,
        permuta: 0,
        financiamento: 400000,
        outros: 0,
      },
    });

    expect(response.status).toBe(201);
    expect(response.header['content-type']).toContain('application/pdf');

    const insertCall = txMock.execute.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO negotiations')
    );
    expect(insertCall).toBeDefined();

    const insertParams = (insertCall?.[1] ?? []) as unknown[];
    expect(Number(insertParams[7])).toBe(500000);
    expect(Number(insertParams[7])).not.toBe(1);

    const paymentDetails = JSON.parse(String(insertParams[8])) as {
      amount: number;
    };
    expect(paymentDetails.amount).toBe(500000);
    expect(insertParams[9]).toBe(expectedDateAfter(10));

    expect(generateProposalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 500000,
        validityDays: 10,
      })
    );
  });
});

