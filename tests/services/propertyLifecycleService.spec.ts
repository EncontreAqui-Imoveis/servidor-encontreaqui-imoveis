import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

const {
  getConnectionMock,
  runPropertyQueryMock,
  notifyAdminsMock,
  dbMock,
} = vi.hoisted(() => {
  const db = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    getConnectionMock: vi.fn(),
    runPropertyQueryMock: vi.fn(),
    notifyAdminsMock: vi.fn(),
    dbMock: db,
  };
});

vi.mock('../../src/services/propertyPersistenceService', () => ({
  getPropertyDbConnection: getConnectionMock,
  runPropertyQuery: runPropertyQueryMock,
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
}));

import {
  cancelPropertyDeal,
  closePropertyDeal,
  deleteProperty,
  resubmitRejectedProperty,
  updatePropertyStatus,
} from '../../src/services/propertyLifecycleService';

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as MockResponse;
}

describe('propertyLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(dbMock);
    dbMock.beginTransaction.mockResolvedValue(undefined);
    dbMock.commit.mockResolvedValue(undefined);
    dbMock.rollback.mockResolvedValue(undefined);
    dbMock.release.mockResolvedValue(undefined);
    dbMock.query.mockResolvedValue([{ affectedRows: 1 }]);
    notifyAdminsMock.mockResolvedValue(undefined);
  });

  it('reenvia imóvel rejeitado para análise', async () => {
    runPropertyQueryMock
      .mockResolvedValueOnce([
        {
          id: 10,
          broker_id: 30003,
          owner_id: null,
          status: 'rejected',
        },
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      userRole: 'broker',
    } as any;
    const res = createMockResponse();

    await resubmitRejectedProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Imovel reenviado para analise.',
        status: 'pending_approval',
      })
    );
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
  });

  it('retorna 409 quando tenta reenviar imóvel que nao esta rejeitado', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
      {
        id: 10,
        broker_id: 30003,
        owner_id: null,
        status: 'approved',
      },
    ]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      userRole: 'broker',
    } as any;
    const res = createMockResponse();

    await resubmitRejectedProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(notifyAdminsMock).not.toHaveBeenCalled();
  });

  it('retorna 400 para status invalido no update status', async () => {
    const req = {
      body: { status: 'inexistente' },
    } as any;
    const res = createMockResponse();

    await updatePropertyStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Status informado é inválido.' })
    );
  });

  it('fecha negocio e grava sale', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
      {
        id: 10,
        broker_id: 30003,
        owner_id: null,
        status: 'approved',
        purpose: 'Venda',
        price_sale: 500000,
        price_rent: null,
        price: 500000,
        commission_rate: 5,
        valor_iptu: 100,
        valor_condominio: 200,
      },
    ]);

    const req = {
      params: { id: '10' },
      userId: 30003,
      body: {
        type: 'sale',
        amount: '500000',
        commission_rate: '6',
        commission_cycles: '2',
        recurrence_interval: 'monthly',
      },
    } as any;
    const res = createMockResponse();

    await closePropertyDeal(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Negócio fechado com sucesso.',
        status: 'sold',
      })
    );
    expect(dbMock.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbMock.commit).toHaveBeenCalledTimes(1);
  });

  it('retorna 400 quando tipo de negocio e invalido', async () => {
    const req = {
      params: { id: '10' },
      userId: 30003,
      body: { type: 'invalid' },
    } as any;
    const res = createMockResponse();

    await closePropertyDeal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(runPropertyQueryMock).not.toHaveBeenCalled();
  });

  it('cancela negocio fechado', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
      {
        id: 10,
        broker_id: 30003,
        owner_id: null,
        status: 'sold',
      },
    ]);

    const req = {
      params: { id: '10' },
      userId: 30003,
    } as any;
    const res = createMockResponse();

    await cancelPropertyDeal(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Negocio cancelado com sucesso.',
        status: 'approved',
      })
    );
    expect(dbMock.beginTransaction).toHaveBeenCalledTimes(1);
    expect(dbMock.commit).toHaveBeenCalledTimes(1);
  });

  it('retorna 400 quando tenta cancelar negocio inexistente', async () => {
    runPropertyQueryMock.mockResolvedValueOnce([
      {
        id: 10,
        broker_id: 30003,
        owner_id: null,
        status: 'approved',
      },
    ]);

    const req = {
      params: { id: '10' },
      userId: 30003,
    } as any;
    const res = createMockResponse();

    await cancelPropertyDeal(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(dbMock.beginTransaction).not.toHaveBeenCalled();
  });

  it('deleta imóvel como sold e remove da vitrine', async () => {
    runPropertyQueryMock
      .mockResolvedValueOnce([
        {
          broker_id: 30003,
          owner_id: null,
          video_url: null,
        },
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const req = {
      params: { id: '10' },
      userId: 30003,
    } as any;
    const res = createMockResponse();

    await deleteProperty(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Imóvel marcado como vendido e removido da vitrine pública.',
        status: 'sold',
      })
    );
  });
});
