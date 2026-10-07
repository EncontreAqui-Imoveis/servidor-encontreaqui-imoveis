import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, sendPushNotificationsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendPushNotificationsMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: { query: queryMock },
}));
vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: sendPushNotificationsMock,
}));

import { createUserNotification } from '../../src/services/notificationService';

describe('draft notification persistence and push copy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(async (sql: string) =>
      sql.includes('INSERT INTO notifications')
        ? [{ insertId: 501, affectedRows: 1 }]
        : [{ affectedRows: 1 }]);
    sendPushNotificationsMock.mockResolvedValue({
      requested: 1, success: 1, failure: 0, errorCodes: [],
    });
  });

  it.each([
    {
      title: 'Minuta pronta para revisão',
      message: 'A minuta do contrato do imóvel Teste está disponível para a sua conferência.',
      recipientRole: 'client' as const,
    },
    {
      title: 'Minuta mantida pela imobiliária',
      message: 'A imobiliária analisou sua solicitação e manteve a minuta atual. Consulte a resposta e registre sua decisão.',
      recipientRole: 'client' as const,
    },
    {
      title: 'Minuta substituída',
      message: 'Uma nova versão da minuta do contrato do imóvel Teste foi publicada. Confira a nova versão e registre sua decisão.',
      recipientRole: 'client' as const,
    },
    {
      title: 'Minuta substituída',
      message: 'Uma nova versão da minuta do contrato do imóvel Teste foi publicada para conferência das partes.',
      recipientRole: 'broker' as const,
    },
  ])('persists and pushes the same copy once: $title / $recipientRole', async (copy) => {
    await createUserNotification({
      ...copy,
      type: 'negotiation',
      recipientId: 101,
      relatedEntityId: 901,
      target: 'contract_details',
      metadata: {
        contractId: 'contract-1', negotiationId: 'neg-1', propertyId: 901,
        draftRevisionId: 92, draftReviewId: 81, draftReviewResolutionId: 71,
      },
    });

    const inserts = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO notifications'));
    expect(inserts).toHaveLength(1);
    const params = inserts[0][1];
    expect(params.slice(0, 2)).toEqual([copy.title, copy.message]);
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationsMock).toHaveBeenCalledWith({
      title: params[0],
      message: params[1],
      recipients: [{
        recipientId: 101,
        metadata: expect.objectContaining({
          draft_revision_id: '92',
          draft_review_id: '81',
          draft_review_resolution_id: '71',
        }),
      }],
    });
  });
});
