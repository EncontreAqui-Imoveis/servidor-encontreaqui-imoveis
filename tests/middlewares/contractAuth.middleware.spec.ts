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
    (req as any).userId = Number(req.header('x-contract-test-user-id') ?? 99);
    (req as any).userRole = req.header('x-contract-test-user-role') ?? 'client';
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
        advertiser_id: 10,
        proposer_id: 99,
        responsible_user_ids: null,
      }]];
    });
  });

  it('injeta contexto comprador quando proposer_id corresponde', async () => {
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
        advertiser_id: 99,
        proposer_id: 99,
        responsible_user_ids: null,
      }]];
    });

    const response = await request(app).get('/contracts/contract-1');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Acesso negado ao contrato.');
  });

  it('reconhece o proprietário do imóvel como seller sem advertiser legado', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return [[{ present: 1 }]];
      }
      return [[{
        id: 'contract-1',
        status: 'AWAITING_DOCS',
        advertiser_id: null,
        proposer_id: 20,
        property_owner_id: 11,
        responsible_user_ids: null,
      }]];
    });

    const response = await request(app)
      .get('/contracts/contract-1')
      .set('x-contract-test-user-id', '11');

    expect(response.status).toBe(200);
    expect(response.body.context).toMatchObject({
      userRole: 'seller',
      canReadSeller: true,
      canEditSeller: true,
      canReadBuyer: false,
    });
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('p.owner_id AS property_owner_id')))
      .toBe(true);
  });

  it('oculta contrato cancelado de participantes mesmo com identificador direto', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return [[{ present: 1 }]];
      }
      return [[{
        id: 'contract-1',
        status: 'CANCELLED',
        advertiser_id: 10,
        proposer_id: 99,
        responsible_user_ids: null,
      }]];
    });

    const response = await request(app).get('/contracts/contract-1');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Contrato não encontrado.');
  });

  it('mantém contrato cancelado acessível para auditoria administrativa', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return [[{ present: 1 }]];
      }
      return [[{
        id: 'contract-1',
        status: 'CANCELLED',
        advertiser_id: 10,
        proposer_id: 99,
        responsible_user_ids: null,
      }]];
    });

    const response = await request(app)
      .get('/contracts/contract-1')
      .set('x-contract-test-user-role', 'admin');

    expect(response.status).toBe(200);
    expect(response.body.context.userRole).toBe('admin');
  });
});
