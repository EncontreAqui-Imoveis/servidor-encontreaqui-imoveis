import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

import { contractController } from '../../src/controllers/ContractController';

describe('GET /admin/commissions', () => {
  const app = express();
  app.get('/admin/commissions', (req, res) =>
    contractController.listCommissions(req, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns summarized VGV and split totals for the month', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 'contract-1',
          negotiation_id: 'neg-1',
          property_id: 101,
          property_title: 'Casa Centro',
          property_code: 'RV-101',
          updated_at: '2026-02-20T10:00:00.000Z',
          commission_data: {
            valorVenda: 500000,
            comissaoCaptador: 15000,
            comissaoVendedor: 10000,
            taxaPlataforma: 2500,
          },
        },
        {
          id: 'contract-2',
          negotiation_id: 'neg-2',
          property_id: 102,
          property_title: 'Apartamento Norte',
          property_code: 'RV-102',
          updated_at: '2026-02-22T14:30:00.000Z',
          commission_data: {
            valorVenda: 300000,
            comissaoCaptador: 9000,
            comissaoVendedor: 6000,
            taxaPlataforma: 1500,
          },
        },
      ],
    ]);

    const response = await request(app).get('/admin/commissions?month=2&year=2026');

    expect(response.status).toBe(200);
    expect(response.body.month).toBe(2);
    expect(response.body.year).toBe(2026);
    expect(response.body.summary).toEqual({
      totalVGV: 800000,
      totalCaptadores: 24000,
      totalVendedores: 16000,
      totalPlataforma: 4000,
    });
    expect(response.body.transactions).toHaveLength(2);
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE c.status = 'FINALIZED'"),
      [2026, 2]
    );
  });

  it('rejects invalid month', async () => {
    const response = await request(app).get('/admin/commissions?month=13&year=2026');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Mês inválido');
    expect(queryMock).not.toHaveBeenCalled();
  });
});

