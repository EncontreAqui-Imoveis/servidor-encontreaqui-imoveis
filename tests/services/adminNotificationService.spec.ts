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

  function arrangeSingleClientNotification() {
    splitRecipientsByRoleMock.mockResolvedValue({ clientIds: [11], brokerIds: [] });
    notifyUsersMock.mockResolvedValue({ requested: 1, success: 1, failure: 0, errorCodes: [] });
  }

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

  it('usa home para anúncio administrativo sem target, sem cair em proposal_list', async () => {
    arrangeSingleClientNotification();

    const result = await sendAdminNotification({
      message: 'Aviso administrativo',
      recipientIds: [11],
      related_entity_type: 'announcement',
    });

    expect(result.statusCode).toBe(201);
    expect(notifyUsersMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'home',
      metadata: null,
    }));
    expect(notifyUsersMock).not.toHaveBeenCalledWith(expect.objectContaining({ target: 'proposal_list' }));
  });

  it('mantém none somente quando enviado explicitamente', async () => {
    arrangeSingleClientNotification();

    const result = await sendAdminNotification({
      message: 'Aviso sem ação',
      recipientIds: [11],
      target: 'none',
    });

    expect(result.statusCode).toBe(201);
    expect(notifyUsersMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'none',
      metadata: null,
    }));
  });

  it.each([
    ['home', 'home'],
    ['notifications', 'notifications'],
    ['proposal_list', 'proposal_list'],
    ['contracts_tab', 'contracts_tab'],
  ] as const)('encaminha o target administrativo %s', async (_label, target) => {
    arrangeSingleClientNotification();

    const result = await sendAdminNotification({
      message: 'Aviso administrativo',
      recipientIds: [11],
      target,
    });

    expect(result.statusCode).toBe(201);
    expect(notifyUsersMock).toHaveBeenCalledWith(expect.objectContaining({ target }));
  });

  it('exige property_id para property_details', async () => {
    const result = await sendAdminNotification({
      message: 'Veja este imóvel',
      recipientIds: [11],
      target: 'property_details',
    });

    expect(result).toMatchObject({
      statusCode: 400,
      body: { code: 'ADMIN_NOTIFICATION_PROPERTY_ID_REQUIRED' },
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it.each([0, -1, 'abc', '1.5', Number.MAX_SAFE_INTEGER + 1])(
    'rejeita property_id inválido: %s',
    async (property_id) => {
      const result = await sendAdminNotification({
        message: 'Veja este imóvel',
        recipientIds: [11],
        target: 'property_details',
        property_id,
      });

      expect(result).toMatchObject({
        statusCode: 400,
        body: { code: 'ADMIN_NOTIFICATION_PROPERTY_ID_INVALID' },
      });
      expect(queryMock).not.toHaveBeenCalled();
    },
  );

  it('valida imóvel e envia property_id confiável para property_details', async () => {
    arrangeSingleClientNotification();
    queryMock.mockResolvedValueOnce([[{ id: 42 }]]);

    const result = await sendAdminNotification({
      message: 'Veja este imóvel',
      recipientIds: [11],
      target: 'property_details',
      property_id: '42',
      related_entity_id: 999,
    });

    expect(result.statusCode).toBe(201);
    expect(queryMock).toHaveBeenCalledWith(
      'SELECT id FROM properties WHERE id = ? LIMIT 1',
      [42],
    );
    expect(notifyUsersMock).toHaveBeenCalledWith(expect.objectContaining({
      target: 'property_details',
      relatedEntityId: 999,
      metadata: { property_id: '42' },
    }));
  });

  it('rejeita property_id que não corresponde a um imóvel existente', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const result = await sendAdminNotification({
      message: 'Veja este imóvel',
      recipientIds: [11],
      target: 'property_details',
      property_id: 42,
    });

    expect(result).toMatchObject({
      statusCode: 400,
      body: { code: 'ADMIN_NOTIFICATION_PROPERTY_NOT_FOUND' },
    });
    expect(notifyUsersMock).not.toHaveBeenCalled();
  });

  it('rejeita property_id para targets que não são property_details', async () => {
    const result = await sendAdminNotification({
      message: 'Aviso administrativo',
      recipientIds: [11],
      target: 'home',
      property_id: 42,
    });

    expect(result).toMatchObject({
      statusCode: 400,
      body: { code: 'ADMIN_NOTIFICATION_PROPERTY_ID_NOT_ALLOWED' },
    });
  });

  it('rejeita target desconhecido, targets de detalhes não administrativos e rota do cliente', async () => {
    const invalidTarget = await sendAdminNotification({
      message: 'Aviso administrativo',
      recipientIds: [11],
      target: 'arbitrary_route',
    });
    const route = await sendAdminNotification({
      message: 'Aviso administrativo',
      recipientIds: [11],
      route: '/arbitrary-route',
    });
    const unsupportedTarget = await sendAdminNotification({
      message: 'Aviso administrativo',
      recipientIds: [11],
      target: 'proposal_details',
    });

    expect(invalidTarget).toMatchObject({
      statusCode: 400,
      body: { code: 'ADMIN_NOTIFICATION_TARGET_INVALID' },
    });
    expect(route).toMatchObject({
      statusCode: 400,
      body: { code: 'ADMIN_NOTIFICATION_ROUTE_NOT_ALLOWED' },
    });
    expect(unsupportedTarget).toMatchObject({
      statusCode: 400,
      body: { code: 'ADMIN_NOTIFICATION_TARGET_INVALID' },
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
