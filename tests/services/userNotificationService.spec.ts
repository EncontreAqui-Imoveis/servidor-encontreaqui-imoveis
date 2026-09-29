import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistUserNotificationMock,
  sendPushNotificationsMock,
} = vi.hoisted(() => ({
  persistUserNotificationMock: vi.fn(),
  sendPushNotificationsMock: vi.fn(),
}));

vi.mock('../../src/services/notificationService', () => ({
  persistUserNotification: persistUserNotificationMock,
}));

vi.mock('../../src/services/pushNotificationService', () => ({
  sendPushNotifications: sendPushNotificationsMock,
}));

import { notifyUsers } from '../../src/services/userNotificationService';

describe('userNotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistUserNotificationMock.mockResolvedValue({
      id: 10,
      recipientId: 1,
      metadata: {
        schema_version: '1',
        target: 'none',
        entity_id: '',
        property_id: '',
        negotiation_id: '',
        contract_id: '',
        notification_id: '10',
        route: '',
      },
    });
    sendPushNotificationsMock.mockResolvedValue({
      requested: 1,
      success: 1,
      failure: 0,
      errorCodes: [],
    });
  });

  it.each([
    ['teste', 'teste'],
    ['teste!', 'teste!'],
    ['  teste  ', 'teste'],
  ])('preserves the normalized message %j as %j', async (message, expected) => {
    await notifyUsers({
      message,
      recipientIds: [1],
      recipientRole: 'client',
      relatedEntityType: 'announcement',
    });

    expect(persistUserNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expected }),
    );
    expect(sendPushNotificationsMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: expected }),
    );
  });
});
