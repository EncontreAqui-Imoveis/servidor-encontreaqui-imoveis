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

import { createWorkflowAdminNotification } from '../../src/services/notificationService';

describe('createWorkflowAdminNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let notificationId = 500;
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM admins a') && sql.includes('LEFT JOIN users u')) {
        return [[
          { id: 11, role: 'admin', is_active: 1, user_id: 101 },
          { id: 12, role: 'document_operator', is_active: 1, user_id: 102 },
          { id: 13, role: 'operational_assistant', is_active: 1, user_id: 103 },
          { id: 14, role: 'admin', is_active: 0, user_id: 104 },
          { id: 15, role: 'admin', is_active: 1, user_id: 103 },
        ]];
      }
      if (sql.includes('INSERT INTO notifications')) {
        notificationId += 1;
        return [{ insertId: notificationId, affectedRows: 1 }];
      }
      if (sql.startsWith('UPDATE notifications SET metadata_json')) {
        return [{ affectedRows: 1 }];
      }
      return [[]];
    });
    sendPushNotificationsMock.mockResolvedValue({
      requested: 1,
      success: 1,
      failure: 0,
      errorCodes: [],
    });
  });

  it('persists and pushes once only for active workflow admins, excluding the requester identity', async () => {
    await createWorkflowAdminNotification({
      type: 'negotiation',
      title: 'Correção solicitada na minuta',
      message: 'Uma das partes solicitou correção. Consulte o contrato.',
      relatedEntityId: 901,
      target: 'contract_details',
      excludeUserIds: [101],
      metadata: {
        contractId: 'contract-1',
        negotiationId: 'neg-1',
        propertyId: 901,
        stage: 'AWAITING_MINUTE_REVIEW',
        draftRevisionId: 7001,
        draftReviewId: 8001,
      },
    });

    const inserts = queryMock.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notifications'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toEqual(expect.arrayContaining([
      'Correção solicitada na minuta',
      'Uma das partes solicitou correção. Consulte o contrato.',
      13,
      'admin',
      'admin',
    ]));
    expect(sendPushNotificationsMock).toHaveBeenCalledTimes(1);
    expect(sendPushNotificationsMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Correção solicitada na minuta',
      message: 'Uma das partes solicitou correção. Consulte o contrato.',
      recipients: [expect.objectContaining({
        recipientId: 103,
        metadata: expect.objectContaining({
          draft_revision_id: '7001',
          draft_review_id: '8001',
        }),
      })],
    }));
  });
});
