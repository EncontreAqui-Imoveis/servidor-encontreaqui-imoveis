import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  txMock,
  getConnectionMock,
  queryMock,
  createAdminNotificationMock,
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
    queryMock: vi.fn(),
    createAdminNotificationMock: vi.fn(),
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

vi.mock('../../src/services/notificationService', () => ({
  createAdminNotification: createAdminNotificationMock,
  createUserNotification: vi.fn(),
  notifyAdmins: vi.fn(),
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
  workflow_metadata: Record<string, unknown> | null;
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
  capturing_agency_name: string | null;
  capturing_agency_address: string | null;
};

function createContractState(
  overrides: Partial<MutableContractState> = {}
): MutableContractState {
  return {
    id: 'contract-sign-1',
    negotiation_id: 'neg-sign-1',
    property_id: 401,
    status: 'AWAITING_SIGNATURES',
    seller_info: {},
    buyer_info: {},
    commission_data: {},
    workflow_metadata: null,
    seller_approval_status: 'APPROVED',
    buyer_approval_status: 'APPROVED',
    seller_approval_reason: null,
    buyer_approval_reason: null,
    created_at: '2026-03-01 09:00:00',
    updated_at: '2026-03-01 09:00:00',
    capturing_broker_id: 30001,
    selling_broker_id: 30002,
    property_title: 'Apartamento Central',
    property_purpose: 'Venda',
    property_code: 'AP-401',
    capturing_broker_name: 'Corretor Captador',
    selling_broker_name: 'Corretor Vendedor',
    capturing_agency_name: 'Imobiliária Centro',
    capturing_agency_address: 'Rua das Flores, 123, Centro',
    ...overrides,
  };
}

describe('POST /contracts/:id/signature-method', () => {
  const app = express();
  app.use(express.json());
  let actingUserId = 30001;
  let actingUserRole = 'broker';
  let actingUserName = 'Broker Teste';
  app.use((req, _res, next) => {
    (req as any).userId = actingUserId;
    (req as any).userRole = actingUserRole;
    (req as any).user = { name: actingUserName };
    next();
  });
  app.post('/contracts/:id/signature-method', (req, res) =>
    contractController.setSignatureMethod(req as any, res)
  );

  let contractState: MutableContractState;

  beforeEach(() => {
    vi.clearAllMocks();
    contractState = createContractState();
    actingUserId = 30001;
    actingUserRole = 'broker';
    actingUserName = 'Broker Teste';

    getConnectionMock.mockResolvedValue(txMock);
    queryMock.mockResolvedValue([]);
    createAdminNotificationMock.mockResolvedValue(undefined);

    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(
      async (sql: string, params: unknown[] = []) => {
        if (sql.includes('FROM contracts c') && sql.includes('FOR UPDATE')) {
          return [[{ ...contractState }]];
        }

        if (
          sql.includes('UPDATE contracts') &&
          sql.includes('workflow_metadata = CAST(? AS JSON)')
        ) {
          contractState.workflow_metadata = JSON.parse(String(params[0] ?? '{}'));
          return [{ affectedRows: 1 }];
        }

        return [[]];
      }
    );
  });

  it('stores in-person choice, returns updated contract and notifies admins', async () => {
    const response = await request(app)
      .post('/contracts/contract-sign-1/signature-method')
      .send({ method: 'in_person' });

    expect(response.status).toBe(200);
    expect(response.body.message).toContain('Assinatura presencial informada');
    expect(response.body.contract.workflowMetadata).toEqual(
      expect.objectContaining({
        signatureMethod: 'in_person',
        signatureMethodDeclaredBy: 30001,
        signatureMethodDeclaredByName: 'Corretor Captador',
      })
    );

    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('workflow_metadata = CAST(? AS JSON)'),
      [
        expect.stringContaining('"signatureMethod":"in_person"'),
        'contract-sign-1',
      ]
    );
    expect(createAdminNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'negotiation',
        title: 'Assinatura presencial informada',
        message: expect.stringContaining('contract-sign-1'),
        relatedEntityId: 401,
        metadata: expect.objectContaining({
          contractId: 'contract-sign-1',
          negotiationId: 'neg-sign-1',
          brokerId: 30001,
          method: 'in_person',
        }),
      })
    );
  });

  it('blocks the choice when contract is not in awaiting signatures', async () => {
    contractState = createContractState({ status: 'IN_DRAFT' });

    const response = await request(app)
      .post('/contracts/contract-sign-1/signature-method')
      .send({ method: 'in_person' });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('AWAITING_SIGNATURES');
    expect(createAdminNotificationMock).not.toHaveBeenCalled();
  });

  it('rejects invalid signature methods', async () => {
    const response = await request(app)
      .post('/contracts/contract-sign-1/signature-method')
      .send({ method: 'online' });

    expect(response.status).toBe(400);
    expect(String(response.body.error ?? '')).toContain('Método de assinatura inválido');
    expect(txMock.beginTransaction).not.toHaveBeenCalled();
    expect(createAdminNotificationMock).not.toHaveBeenCalled();
  });

  it('blocks the choice when broker is not part of the contract', async () => {
    actingUserId = 99999;
    actingUserName = 'Intruso';

    const response = await request(app)
      .post('/contracts/contract-sign-1/signature-method')
      .send({ method: 'in_person' });

    expect(response.status).toBe(403);
    expect(String(response.body.error ?? '')).toContain('Acesso negado');
    expect(createAdminNotificationMock).not.toHaveBeenCalled();
  });

  it('rejects admin usage of the broker-only endpoint', async () => {
    actingUserRole = 'admin';

    const response = await request(app)
      .post('/contracts/contract-sign-1/signature-method')
      .send({ method: 'in_person' });

    expect(response.status).toBe(403);
    expect(String(response.body.error ?? '')).toContain('exclusivo para o corretor');
    expect(txMock.beginTransaction).not.toHaveBeenCalled();
    expect(createAdminNotificationMock).not.toHaveBeenCalled();
  });
});
