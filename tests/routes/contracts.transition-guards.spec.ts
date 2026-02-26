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

type MutableContractState = {
  id: string;
  negotiation_id: string;
  property_id: number;
  status: string;
  seller_info: Record<string, unknown>;
  buyer_info: Record<string, unknown>;
  commission_data: Record<string, unknown>;
  seller_approval_status: string;
  buyer_approval_status: string;
  seller_approval_reason: Record<string, unknown> | null;
  buyer_approval_reason: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  capturing_broker_id: number;
  selling_broker_id: number;
  property_title: string;
  property_purpose: string;
  property_code: string;
  capturing_broker_name: string;
  selling_broker_name: string;
};

function createContractState(
  overrides: Partial<MutableContractState> = {}
): MutableContractState {
  return {
    id: 'contract-1',
    negotiation_id: 'neg-1',
    property_id: 101,
    status: 'IN_DRAFT',
    seller_info: {},
    buyer_info: {},
    commission_data: {},
    seller_approval_status: 'APPROVED',
    buyer_approval_status: 'APPROVED',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-02-20 10:00:00',
    updated_at: '2026-02-20 10:00:00',
    capturing_broker_id: 30001,
    selling_broker_id: 30002,
    property_title: 'Casa Centro',
    property_purpose: 'Venda',
    property_code: 'RV-101',
    capturing_broker_name: 'Captador',
    selling_broker_name: 'Vendedor',
    ...overrides,
  };
}

describe('PUT /admin/contracts/:id/transition guards', () => {
  const app = express();
  app.use(express.json());
  app.put('/admin/contracts/:id/transition', (req, res) =>
    contractController.transitionStatus(req as any, res)
  );

  let contractState: MutableContractState;
  let draftTotal = 0;

  beforeEach(() => {
    vi.clearAllMocks();

    contractState = createContractState();
    draftTotal = 0;

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
        return [[{ ...contractState }]];
      }

      if (sql.includes('FROM negotiation_documents') && sql.includes('draft_total')) {
        return [[
          {
            draft_total: draftTotal,
            signed_contract_total: 0,
            payment_receipt_total: 0,
            inspection_boleto_total: 0,
          },
        ]];
      }

      if (
        sql.includes('UPDATE contracts') &&
        sql.includes('SET status = ?, updated_at = CURRENT_TIMESTAMP')
      ) {
        contractState.status = String(params[0] ?? contractState.status);
        return [{ affectedRows: 1 }];
      }

      return [[]];
    });
  });

  it('blocks rollback from FINALIZED to previous stages', async () => {
    contractState = createContractState({ status: 'FINALIZED' });

    const response = await request(app)
      .put('/admin/contracts/contract-1/transition')
      .send({ direction: 'previous' });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('Retrocesso');
  });

  it('blocks moving to AWAITING_SIGNATURES without valid draft', async () => {
    contractState = createContractState({ status: 'IN_DRAFT' });
    draftTotal = 0;

    const response = await request(app)
      .put('/admin/contracts/contract-1/transition')
      .send({ direction: 'next' });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('minuta');
    expect(contractState.status).toBe('IN_DRAFT');
  });

  it('allows moving to AWAITING_SIGNATURES only when draft exists for this contract', async () => {
    contractState = createContractState({ status: 'IN_DRAFT' });
    draftTotal = 1;

    const response = await request(app)
      .put('/admin/contracts/contract-1/transition')
      .send({ direction: 'next' });

    expect(response.status).toBe(200);
    expect(response.body.contract.status).toBe('AWAITING_SIGNATURES');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
  });
});

