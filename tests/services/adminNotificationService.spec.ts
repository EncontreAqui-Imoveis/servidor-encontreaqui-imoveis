import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, notifyUsersMock, splitRecipientsByRoleMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notifyUsersMock: vi.fn(),
  splitRecipientsByRoleMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  splitRecipientsByRole: splitRecipientsByRoleMock,
}));

import { sendAdminNotification } from '../../src/services/adminNotificationService';

describe('adminNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita mensagem vazia', async () => {
    const result = await sendAdminNotification({ message: '   ' });

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toBe('A mensagem e obrigatoria.');
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('distribui notificação entre clientes e corretores com títulos normalizados', async () => {
    splitRecipientsByRoleMock.mockResolvedValueOnce({ clientIds: [11], brokerIds: [22] });
    notifyUsersMock
      .mockResolvedValueOnce({ requested: 1, success: 1, failure: 0, errorCodes: [] })
      .mockResolvedValueOnce({ requested: 1, success: 1, failure: 0, errorCodes: [] });

    const result = await sendAdminNotification({
      message: ' Mensagem teste ',
      recipientIds: [11, 22],
      audience: 'all',
      related_entity_type: 'property',
      related_entity_id: 15,
      pushAction: '  action_x  ',
      title: '  Aviso  ',
    });

    expect(splitRecipientsByRoleMock).toHaveBeenCalledWith([11, 22]);
    expect(notifyUsersMock).toHaveBeenCalledTimes(2);
    expect(notifyUsersMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: 'Mensagem teste',
        recipientIds: [11],
        recipientRole: 'client',
        relatedEntityType: 'property',
        relatedEntityId: 15,
        pushAction: 'action_x',
        title: 'Aviso',
      }),
    );
    expect(notifyUsersMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Mensagem teste',
        recipientIds: [22],
        recipientRole: 'broker',
        relatedEntityType: 'property',
        relatedEntityId: 15,
        pushAction: 'action_x',
        title: 'Aviso',
      }),
    );
    expect(result.statusCode).toBe(201);
    expect(result.body.push).toMatchObject({
      requested: 2,
      success: 2,
      failure: 0,
    });
  });

  it('valida favoritos com property e id obrigatório', async () => {
    const result = await sendAdminNotification({
      message: 'Teste',
      audience: 'favorites',
      related_entity_type: 'broker',
      related_entity_id: null,
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toContain("related_entity_type='property'");
    expect(queryMock).not.toHaveBeenCalled();
  });
});
