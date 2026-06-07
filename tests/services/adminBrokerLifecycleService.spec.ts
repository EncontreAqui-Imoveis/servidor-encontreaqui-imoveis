import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConnectionMock,
  queryMock,
  txMock,
  loadUserLifecycleSnapshotMock,
  approveBrokerAccountMock,
  rejectBrokerAccountMock,
  uploadToCloudinaryMock,
  deleteCloudinaryAssetMock,
  notifyAdminsMock,
  notifyUsersMock,
  resolveUserNotificationRoleMock,
} = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    getConnectionMock: vi.fn(),
    queryMock: vi.fn(),
    txMock: tx,
    loadUserLifecycleSnapshotMock: vi.fn(),
    approveBrokerAccountMock: vi.fn(),
    rejectBrokerAccountMock: vi.fn(),
    uploadToCloudinaryMock: vi.fn(),
    deleteCloudinaryAssetMock: vi.fn(),
    notifyAdminsMock: vi.fn(),
    notifyUsersMock: vi.fn(),
    resolveUserNotificationRoleMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  __esModule: true,
  adminDb: {
    getConnection: getConnectionMock,
    query: queryMock,
  },
}));

vi.mock('../../src/services/adminAccountLifecycleService', () => ({
  loadUserLifecycleSnapshot: loadUserLifecycleSnapshotMock,
  approveBrokerAccount: approveBrokerAccountMock,
  rejectBrokerAccount: rejectBrokerAccountMock,
  isActiveBrokerStatus: (status: unknown) =>
    ['pending_verification', 'approved'].includes(String(status ?? '').trim()),
}));

vi.mock('../../src/config/cloudinary', () => ({
  __esModule: true,
  uploadToCloudinary: uploadToCloudinaryMock,
  deleteCloudinaryAsset: deleteCloudinaryAssetMock,
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/services/userNotificationService', () => ({
  notifyUsers: notifyUsersMock,
  resolveUserNotificationRole: resolveUserNotificationRoleMock,
}));

import {
  cleanupBroker,
  deleteBrokerDocument,
  promoteClientToBroker,
  updateBrokerStatus,
  uploadBrokerDocuments,
} from '../../src/services/adminBrokerLifecycleService';

describe('adminBrokerLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    notifyAdminsMock.mockResolvedValue(undefined);
    notifyUsersMock.mockResolvedValue(undefined);
    resolveUserNotificationRoleMock.mockResolvedValue('broker');
    approveBrokerAccountMock.mockResolvedValue({ snapshot: { broker_id: 1 }, affected: true });
    rejectBrokerAccountMock.mockResolvedValue({ snapshot: { broker_id: 1 }, affected: true });
  });

  it('promove cliente a corretor e dispara notificação de aprovação', async () => {
    txMock.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    loadUserLifecycleSnapshotMock.mockResolvedValue({
      id: 10,
      name: 'Cliente',
      email: 'cliente@example.com',
      broker_id: null,
      broker_status: null,
    });

    const payload = await promoteClientToBroker(10, '12345678');

    expect(payload).toMatchObject({
      status: 'approved',
      role: 'broker',
      creci: '12345678',
    });
    expect(txMock.commit).toHaveBeenCalledTimes(1);
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: [10],
        recipientRole: 'broker',
      }),
    );
  });

  it('atualiza status de corretor para rejected e revoga sessões sem quebrar contrato', async () => {
    loadUserLifecycleSnapshotMock.mockResolvedValue({
      id: 20,
      name: 'Broker',
      email: 'broker@example.com',
      broker_id: 20,
      broker_status: 'approved',
    });
    rejectBrokerAccountMock.mockResolvedValue({ snapshot: { broker_id: 20 }, affected: true });

    const payload = await updateBrokerStatus(20, 'rejected');

    expect(payload).toMatchObject({
      status: 'rejected',
      role: 'client',
    });
    expect(rejectBrokerAccountMock).toHaveBeenCalled();
    expect(notifyUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientRole: 'client',
        relatedEntityType: 'broker',
      }),
    );
  });

  it('faz upload parcial de documentos preservando histórico', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    queryMock.mockResolvedValueOnce([
      [{ creci_front_url: '', creci_back_url: 'https://cdn/back.jpg', selfie_url: 'https://cdn/selfie.jpg' }],
    ]);
    uploadToCloudinaryMock.mockResolvedValueOnce({ url: 'https://cdn/new-front.jpg' });

    const payload = await uploadBrokerDocuments(12, {
      creciFront: [{ path: 'front.png' }] as Express.Multer.File[],
    });

    expect(payload.message).toBe('Documentos atualizados com sucesso.');
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(1);
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents'),
      [12, 'https://cdn/new-front.jpg', 'https://cdn/back.jpg', 'https://cdn/selfie.jpg'],
    );
  });

  it('remove documento do corretor e invalida asset remoto', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [{ creci_front_url: 'https://cdn.example.com/front.jpg' }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    deleteCloudinaryAssetMock.mockResolvedValue({ deleted: true });

    const payload = await deleteBrokerDocument(12, 'creciFront');

    expect(payload.message).toBe('Documento removido com sucesso.');
    expect(deleteCloudinaryAssetMock).toHaveBeenCalledWith({
      url: 'https://cdn.example.com/front.jpg',
      invalidate: true,
    });
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE broker_documents SET creci_front_url = ?, status = \'pending\', updated_at = CURRENT_TIMESTAMP WHERE broker_id = ?',
      ['', 12],
    );
  });

  it('rebaixa corretor para cliente com a mensagem esperada', async () => {
    loadUserLifecycleSnapshotMock.mockResolvedValue({
      id: 30,
      name: 'Broker',
      email: 'broker30@example.com',
      broker_id: 30,
      broker_status: 'approved',
    });

    const payload = await cleanupBroker(30);

    expect(payload.message).toBe('Corretor rebaixado para cliente com sucesso.');
    expect(rejectBrokerAccountMock).toHaveBeenCalled();
  });
});
