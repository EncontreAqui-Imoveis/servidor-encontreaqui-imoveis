import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

import {
  clearAnnouncementNotifications,
  clearNotifications,
  deleteNotification,
  getNotifications,
} from '../../src/services/adminNotificationManagementService';

describe('adminNotificationManagementService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lista notificações com filtro de tipo e paginação', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 1, title: 'Aviso' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const result = await getNotifications({
      adminId: 77,
      page: '2',
      limit: '5',
      type: 'announcement',
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      data: [{ id: 1, title: 'Aviso' }],
      total: 1,
      page: 2,
      limit: 5,
    });
  });

  it('retorna false quando não remove notificação', async () => {
    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(deleteNotification({ adminId: 7, notificationId: 3 })).resolves.toBe(false);
  });

  it('remove notificações gerais e de anúncio sem erro', async () => {
    queryMock.mockResolvedValue({});

    await clearNotifications(9);
    await clearAnnouncementNotifications(9);

    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
