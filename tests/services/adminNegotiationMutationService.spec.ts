import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../src/errors/ApplicationError';

const {
  getConnectionMock,
  txMock,
  createUserNotificationMock,
  sendPushNotificationsMock,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    getConnectionMock: vi.fn(),
    txMock: tx,
    createUserNotificationMock: vi.fn(),
    sendPushNotificationsMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  createUserNotification: createUserNotificationMock,
  notifyAdmins: vi.fn(),
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: sendPushNotificationsMock,
}));

import {
  approveNegotiation,
  cancelNegotiation,
  rejectNegotiation,
  updateNegotiationSellingBroker,
} from '../../src/services/adminNegotiationMutationService';

describe('adminNegotiationMutationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    createUserNotificationMock.mockResolvedValue(undefined);
    sendPushNotificationsMock.mockResolvedValue({
      requested: 1,
      success: 1,
      failure: 0,
      errorCodes: [],
    });
  });

  it('aprova negociação, cria contrato e notifica o corretor captador', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            status: 'PROPOSAL_SENT',
            property_id: 101,
            property_broker_id: 30005,
            capturing_broker_id: 30003,
            responsible_broker_id: null,
            property_title: 'Casa Centro',
            property_code: 'RV-101',
            property_address: 'Rua 1',
            property_status: 'approved',
            lifecycle_status: 'AVAILABLE',
          },
        ],
      ])
      .mockResolvedValueOnce([[{ id: 501 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 'contract-1' }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const payload = await approveNegotiation({
      negotiationId: 'neg-1',
      actorId: 9,
    });

    expect(payload).toMatchObject({
      message: 'Negociação aprovada com sucesso.',
      id: 'neg-1',
      status: 'APPROVED',
      internalStatus: 'IN_NEGOTIATION',
    });
    expect(createUserNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 30003,
        metadata: expect.objectContaining({
          adminId: 9,
          status: 'APPROVED',
        }),
      })
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('rejeita aprovação quando nao existe proposta assinada', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            status: 'PROPOSAL_SENT',
            property_id: 101,
            property_broker_id: 30005,
            capturing_broker_id: 30003,
            responsible_broker_id: null,
            property_title: 'Casa Centro',
            property_code: 'RV-101',
            property_address: 'Rua 1',
            property_status: 'approved',
            lifecycle_status: 'AVAILABLE',
          },
        ],
      ])
      .mockResolvedValueOnce([[]]);

    const rejection = approveNegotiation({
      negotiationId: 'neg-1',
      actorId: 9,
    });

    await expect(rejection).rejects.toMatchObject({
      message: 'Não é possível aprovar sem PDF assinado. Envie a proposta assinada antes de aprovar.',
      details: { code: 'SIGNED_PROPOSAL_REQUIRED' },
    });
    await expect(rejection).rejects.toBeInstanceOf(InvalidInputError);

    expect(txMock.rollback).toHaveBeenCalled();
    expect(txMock.commit).not.toHaveBeenCalled();
  });

  it('rejeita negociação, mantém histórico e notifica broker e cliente', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-2',
            status: 'PROPOSAL_SENT',
            property_id: 202,
            property_broker_id: 30005,
            capturing_broker_id: 30003,
            responsible_broker_id: null,
            buyer_client_id: 70001,
            property_title: 'Apartamento Vista Mar',
            property_code: 'RV-202',
            property_address: 'Rua 2',
            property_status: 'approved',
            lifecycle_status: 'AVAILABLE',
          },
        ],
      ])
      .mockResolvedValueOnce([[{ cnt: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const payload = await rejectNegotiation({
      negotiationId: 'neg-2',
      actorId: 11,
      reason: 'Documentação incompleta.',
    });

    expect(payload).toMatchObject({
      message: 'Negociação recusada e mantida em histórico.',
      id: 'neg-2',
      status: 'REFUSED',
    });
    expect(createUserNotificationMock).toHaveBeenCalledTimes(2);
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('retorna 404 ao rejeitar negociação inexistente', async () => {
    txMock.query.mockResolvedValueOnce([[]]);

    await expect(
      rejectNegotiation({
        negotiationId: 'neg-x',
        actorId: 11,
        reason: 'Documentação incompleta.',
      })
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(txMock.rollback).toHaveBeenCalled();
    expect(createUserNotificationMock).not.toHaveBeenCalled();
  });

  it('cancela negociação e dispara push para o corretor captador', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-3',
            status: 'IN_NEGOTIATION',
            property_id: 303,
            capturing_broker_id: 30003,
            property_title: 'Casa Jardim',
            property_code: 'RV-303',
            property_address: 'Rua 3',
            property_status: 'negociacao',
            lifecycle_status: 'AVAILABLE',
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const payload = await cancelNegotiation({
      negotiationId: 'neg-3',
      actorId: 13,
      reason: 'Cliente desistiu da negociação.',
    });

    expect(payload).toMatchObject({
      message: 'Negociação cancelada e imóvel devolvido para disponível.',
      id: 'neg-3',
      status: 'CANCELLED',
    });
    expect(createUserNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: [30003],
      })
    );
  });

  it('bloqueia cancelamento de negociação finalizada', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 'neg-3',
          status: 'SOLD',
          property_id: 303,
          capturing_broker_id: 30003,
          property_title: 'Casa Jardim',
          property_code: 'RV-303',
          property_address: 'Rua 3',
          property_status: 'vendido',
          lifecycle_status: 'SOLD',
        },
      ],
    ]);

    await expect(
      cancelNegotiation({
        negotiationId: 'neg-3',
        actorId: 13,
        reason: 'Cliente desistiu da negociação.',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(txMock.rollback).toHaveBeenCalled();
    expect(createUserNotificationMock).not.toHaveBeenCalled();
    expect(sendPushNotificationsMock).not.toHaveBeenCalled();
  });

  it('sincroniza o responsável operacional com o captador da negociação', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-4',
            status: 'PROPOSAL_SENT',
            capturing_broker_id: 40004,
            selling_broker_id: 50005,
          },
        ],
      ])
      .mockResolvedValueOnce([[{ name: 'Broker Captador' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const payload = await updateNegotiationSellingBroker({
      negotiationId: 'neg-4',
      actorId: 19,
      sellingBrokerIdRaw: 12345,
    });

    expect(payload).toMatchObject({
      message: 'Responsável operacional sincronizado com o captador.',
      negotiationId: 'neg-4',
      capturingBrokerId: 40004,
      sellingBrokerId: 40004,
      sameAsCapturing: true,
      sellingBrokerName: 'Broker Captador',
    });
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('rejeita update do responsável operacional com id invalido sem abrir transacao', async () => {
    await expect(
      updateNegotiationSellingBroker({
        negotiationId: 'neg-4',
        actorId: 19,
        sellingBrokerIdRaw: 'abc',
      })
    ).rejects.toBeInstanceOf(InvalidInputError);

    expect(getConnectionMock).not.toHaveBeenCalled();
  });
});
