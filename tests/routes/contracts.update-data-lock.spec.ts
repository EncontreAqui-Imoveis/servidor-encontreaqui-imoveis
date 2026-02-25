import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { txMock, getConnectionMock, queryMock } = vi.hoisted(() => {
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
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    query: queryMock,
    execute: vi.fn(),
  },
}));

import { contractController } from '../../src/controllers/ContractController';

type MutableContractRow = Record<string, unknown>;

describe('PUT /contracts/:id/data', () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = 30003;
    (req as any).userRole = 'broker';
    next();
  });
  app.put('/contracts/:id/data', (req, res) =>
    contractController.updateData(req as any, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
  });

  it('bloqueia atualização do lado seller quando já está APPROVED', async () => {
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
        return [[
          {
            id: 'contract-1',
            negotiation_id: 'neg-1',
            property_id: 101,
            status: 'AWAITING_DOCS',
            seller_info: { email: 'old@test.com' },
            buyer_info: {},
            commission_data: {},
            seller_approval_status: 'APPROVED',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: null,
            buyer_approval_reason: null,
            created_at: '2026-02-20 10:00:00',
            updated_at: '2026-02-20 10:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            property_title: 'Casa Teste',
            property_purpose: 'Venda',
            property_code: 'RV-101',
            capturing_broker_name: 'Captador',
            selling_broker_name: 'Vendedor',
          },
        ]];
      }

      if (sql.includes('UPDATE contracts') && sql.includes('seller_info')) {
        throw new Error('não deveria atualizar');
      }

      return [[]];
    });

    const response = await request(app)
      .put('/contracts/contract-1/data')
      .send({
        sellerInfo: {
          email: 'new@test.com',
        },
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('seller');
    const updateCalls = txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE contracts') && String(sql).includes('seller_info')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('sobrescreve sellerInfo sem mesclar chaves antigas', async () => {
    const contractState: MutableContractRow = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
      property_id: 101,
      status: 'AWAITING_DOCS',
      seller_info: { email: 'old@test.com', legacy: 'remove-me' },
      buyer_info: { keep: true },
      commission_data: {},
      seller_approval_status: 'PENDING',
      buyer_approval_status: 'PENDING',
      seller_approval_reason: null,
      buyer_approval_reason: null,
      created_at: '2026-02-20 10:00:00',
      updated_at: '2026-02-20 10:00:00',
      capturing_broker_id: 30003,
      selling_broker_id: 30004,
      property_title: 'Casa Teste',
      property_purpose: 'Venda',
      property_code: 'RV-101',
      capturing_broker_name: 'Captador',
      selling_broker_name: 'Vendedor',
    };

    txMock.query.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
          return [[{ ...contractState }]];
        }

        if (sql.includes('UPDATE contracts') && sql.includes('seller_info')) {
          const sellerPayload = JSON.parse(String(params[0] ?? '{}')) as Record<
            string,
            unknown
          >;
          const buyerPayload = JSON.parse(String(params[1] ?? '{}')) as Record<
            string,
            unknown
          >;

          expect(sellerPayload).toEqual({ email: 'new@test.com' });
          expect(sellerPayload).not.toHaveProperty('legacy');
          expect(buyerPayload).toEqual({ keep: true });

          contractState.seller_info = sellerPayload;
          contractState.buyer_info = buyerPayload;
          return [{ affectedRows: 1 }];
        }

        return [[]];
      }
    );

    const response = await request(app)
      .put('/contracts/contract-1/data')
      .send({
        sellerInfo: {
          email: 'new@test.com',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.contract.sellerInfo).toEqual({ email: 'new@test.com' });
    expect(response.body.contract.sellerInfo).not.toHaveProperty('legacy');
    expect(response.body.contract.buyerInfo).toEqual({ keep: true });
  });
});
