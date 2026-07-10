import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: { query: queryMock },
}));

import { contractAuthMiddleware } from '../../src/middlewares/contractAuth.middleware';

describe('contractAuthMiddleware', () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).userId = 99;
    (req as any).userRole = 'client';
    (req as any).userCpf = '222.222.222-22';
    next();
  });
  app.get('/contracts/:id', contractAuthMiddleware, (req, res) =>
    res.status(200).json({ context: (req as any).contractContext })
  );

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return [[{ present: 1 }]];
      }
      return [[{
        id: 'contract-1',
        status: 'AWAITING_DOCS',
        seller_client_id: 10,
        buyer_client_id: 20,
        seller_cpf: '111.111.111-11',
        buyer_cpf: '222.222.222-22',
        responsible_user_ids: null,
      }]];
    });
  });

  it('injeta contexto comprador quando CPF corresponde', async () => {
    const response = await request(app).get('/contracts/contract-1');

    expect(response.status).toBe(200);
    expect(response.body.context).toMatchObject({
      contractId: 'contract-1',
      userRole: 'buyer',
      canEditBuyer: true,
      canEditSeller: false,
    });
  });

  it('retorna 403 para identidade dupla antes de chamar controller', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return [[{ present: 1 }]];
      }
      return [[{
        id: 'contract-1',
        status: 'AWAITING_DOCS',
        seller_client_id: 20,
        buyer_client_id: 20,
        seller_cpf: '222.222.222-22',
        buyer_cpf: '222.222.222-22',
        responsible_user_ids: null,
      }]];
    });

    const response = await request(app).get('/contracts/contract-1');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Acesso negado ao contrato.');
  });
});
