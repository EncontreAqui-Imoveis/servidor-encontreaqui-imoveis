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
    (req as any).userRole = 'client';
    (req as any).contractContext = {
      userRole: 'seller',
      canReadMeta: true,
      canReadSeller: true,
      canReadBuyer: false,
      canEditSeller: true,
      canEditBuyer: false,
      isReadOnly: false,
    };
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

  it('bloqueia atualização do vendedor quando contrato está em assinatura', async () => {
    txMock.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
        return [[
          {
            id: 'contract-1',
            negotiation_id: 'neg-1',
            advertiser_id: 30003,
            proposer_id: 30004,
            initiator_side: 'buyer',
            property_id: 101,
            status: 'AWAITING_SIGNATURES',
            seller_cpf: '111.111.111-11',
            buyer_cpf: '222.222.222-22',
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
        side: 'seller',
        sellerInfo: {
          email: 'new@test.com',
        },
      });

    expect(response.status).toBe(403);
    expect(response.body.error).toContain('modo somente leitura');
    const updateCalls = txMock.query.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE contracts') && String(sql).includes('seller_info')
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('preserva os campos existentes do vendedor em salvamento parcial', async () => {
    const contractState: MutableContractRow = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
      advertiser_id: 30003,
      proposer_id: 30004,
      initiator_side: 'buyer',
      property_id: 101,
      status: 'AWAITING_DOCS',
      seller_cpf: '111.111.111-11',
      buyer_cpf: '222.222.222-22',
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

          expect(sellerPayload).toMatchObject({
            email: 'new@test.com',
            legacy: 'remove-me',
            cpf: null,
          });
          expect(sellerPayload.cpf_ciphertext).toEqual(expect.any(String));
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
        side: 'seller',
        sellerInfo: {
          email: 'new@test.com',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.contract.sellerInfo).toMatchObject({
      email: 'new@test.com',
      legacy: 'remove-me',
      cpf: '11111111111',
    });
    expect(response.body.contract.buyerInfo).toEqual({});
  });

  it('aceita ownerInfo como alias de sellerInfo', async () => {
    const contractState: MutableContractRow = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
      advertiser_id: 30003,
      proposer_id: 30004,
      initiator_side: 'buyer',
      property_id: 101,
      status: 'AWAITING_DOCS',
      seller_cpf: '111.111.111-11',
      buyer_cpf: '222.222.222-22',
      seller_info: { email: 'owner-old@test.com', legacy: 'remove-me' },
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
          expect(sellerPayload).toMatchObject({
            email: 'owner-new@test.com',
            legacy: 'remove-me',
            cpf: null,
          });
          expect(sellerPayload.cpf_ciphertext).toEqual(expect.any(String));
          contractState.seller_info = sellerPayload;
          return [{ affectedRows: 1 }];
        }

        return [[]];
      }
    );

    const response = await request(app)
      .put('/contracts/contract-1/data')
      .send({
        side: 'seller',
        ownerInfo: {
          email: 'owner-new@test.com',
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.contract.sellerInfo).toMatchObject({
      email: 'owner-new@test.com',
      legacy: 'remove-me',
      cpf: '11111111111',
    });
    expect(response.body.contract.ownerInfo).toMatchObject({
      email: 'owner-new@test.com',
      legacy: 'remove-me',
      cpf: '11111111111',
    });
  });

  it('rejeita bloco do comprador dentro da atualização do vendedor', async () => {
    const response = await request(app)
      .put('/contracts/contract-1/data')
      .send({
        side: 'seller',
        sellerInfo: {
          email: 'seller@test.com',
          buyerInfo: { email: 'buyer@test.com' },
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('comprador');
  });

  it('rejeita bloco do vendedor dentro da atualização do comprador', async () => {
    const response = await request(app)
      .put('/contracts/contract-1/data')
      .send({
        side: 'buyer',
        buyerInfo: {
          email: 'buyer@test.com',
          seller_info: { email: 'seller@test.com' },
        },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('vendedor');
  });
});
