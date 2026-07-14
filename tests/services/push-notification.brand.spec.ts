import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, sendEachForMulticastMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sendEachForMulticastMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    messaging: () => ({
      sendEachForMulticast: sendEachForMulticastMock,
    }),
  },
}));

import { sendPushNotifications } from '../../src/services/pushNotificationService';

describe('pushNotificationService branding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses Encontre Aqui as push notification title', async () => {
    queryMock.mockResolvedValueOnce([
      [
        { user_id: 10, fcm_token: 'token-1' },
      ],
    ]);
    sendEachForMulticastMock.mockResolvedValueOnce({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true }],
    });

    await sendPushNotifications({
      message: 'Mensagem teste',
      recipients: [
        {
          recipientId: 10,
          metadata: {
            schema_version: '1',
            target: 'proposal_details',
            entity_id: 'negotiation-1',
            property_id: '12',
            negotiation_id: 'negotiation-1',
            contract_id: '',
            notification_id: '99',
            route: '/proposals/negotiation-1',
          },
        },
      ],
    });

    expect(sendEachForMulticastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          title: 'Encontre Aqui',
          body: 'Mensagem teste',
        }),
        data: {
          schema_version: '1',
          target: 'proposal_details',
          entity_id: 'negotiation-1',
          property_id: '12',
          negotiation_id: 'negotiation-1',
          contract_id: '',
          notification_id: '99',
          route: '/proposals/negotiation-1',
        },
      })
    );
  });
});

