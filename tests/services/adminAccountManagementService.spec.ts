import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  getConnectionMock,
  txMock,
  loadUserLifecycleSnapshotMock,
  approveBrokerAccountMock,
  rejectBrokerAccountMock,
  deleteUserAccountMock,
  notifyAdminsMock,
  notifyUsersMock,
  resolveUserNotificationRoleMock,
  sanitizePartialAddressInputMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getConnectionMock: vi.fn(),
  txMock: {
    beginTransaction: vi.fn(),
    rollback: vi.fn(),
    commit: vi.fn(),
    release: vi.fn(),
    query: vi.fn(),
  },
  loadUserLifecycleSnapshotMock: vi.fn(),
  approveBrokerAccountMock: vi.fn(),
  rejectBrokerAccountMock: vi.fn(),
  deleteUserAccountMock: vi.fn(),
  notifyAdminsMock: vi.fn(),
  notifyUsersMock: vi.fn(),
  resolveUserNotificationRoleMock: vi.fn(),
  sanitizePartialAddressInputMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/adminAccountLifecycleService', () => ({
  approveBrokerAccount: approveBrokerAccountMock,
  deleteUserAccount: deleteUserAccountMock,
  isActiveBrokerStatus: (status: unknown) => String(status ?? '').trim() === 'approved',
  loadUserLifecycleSnapshot: loadUserLifecycleSnapshotMock,
  rejectBrokerAccount: rejectBrokerAccountMock,
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  resolveUserNotificationRole: resolveUserNotificationRoleMock,
}));

vi.mock('../../src/services/adminControllerSupport', () => ({
  hasValidCreci: (value: unknown) => String(value ?? '').length >= 5,
  normalizeCreci: (value: unknown) => String(value ?? '').trim(),
  sanitizePartialAddressInput: sanitizePartialAddressInputMock,
}));

import {
  deleteBrokerAccountAdmin,
  updateBrokerAccount,
} from '../../src/services/adminAccountManagementService';

describe('adminAccountManagementService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.query.mockResolvedValue([[], []]);
    loadUserLifecycleSnapshotMock.mockResolvedValue(null);
    approveBrokerAccountMock.mockResolvedValue({ snapshot: null, affected: false });
    rejectBrokerAccountMock.mockResolvedValue({ snapshot: null, affected: false });
    deleteUserAccountMock.mockResolvedValue({ snapshot: null, affected: false });
    notifyAdminsMock.mockResolvedValue(undefined);
    notifyUsersMock.mockResolvedValue(undefined);
    resolveUserNotificationRoleMock.mockResolvedValue('broker');
    sanitizePartialAddressInputMock.mockReturnValue({ ok: true, value: {} });
  });

  it('rejects invalid broker status without opening a transaction', async () => {
    await expect(
      updateBrokerAccount({
        brokerId: 12,
        body: { status: 'inválido' },
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it('returns not found when deleting missing broker', async () => {
    loadUserLifecycleSnapshotMock.mockResolvedValueOnce(null);

    await expect(deleteBrokerAccountAdmin(99)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(txMock.beginTransaction).toHaveBeenCalled();
    expect(txMock.rollback).toHaveBeenCalled();
    expect(deleteUserAccountMock).not.toHaveBeenCalled();
  });
});
