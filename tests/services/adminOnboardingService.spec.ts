import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  getConnectionMock,
  txMock,
  uploadToCloudinaryMock,
  notifyAdminsMock,
} = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test';

  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    queryMock: vi.fn(),
    getConnectionMock: vi.fn(),
    txMock: tx,
    uploadToCloudinaryMock: vi.fn(),
    notifyAdminsMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/notificationService', () => ({
  notifyAdmins: notifyAdminsMock,
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: uploadToCloudinaryMock,
  deleteCloudinaryAsset: vi.fn(),
}));

import { createBrokerAccountAdmin, createUserAccountAdmin } from '../../src/services/adminOnboardingService';

describe('adminOnboardingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.query.mockResolvedValue([[]]);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    notifyAdminsMock.mockResolvedValue(undefined);
    uploadToCloudinaryMock.mockResolvedValue({ url: 'https://img.test/upload.jpg' });
  });

  it('cria usuario cliente e retorna role client', async () => {
    queryMock
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 1001, affectedRows: 1 }]);

    const result = await createUserAccountAdmin({
      body: {
        name: 'Cliente Teste',
        email: 'cliente@test.com',
        phone: '(64) 99999-0000',
        password: '123456',
        street: 'Rua A',
        number: '10',
        bairro: 'Centro',
        city: 'Rio Verde',
        state: 'GO',
        cep: '75900000',
      },
    });

    expect(result).toMatchObject({
      message: 'Usuario criado com sucesso.',
      user_id: 1001,
      role: 'client',
    });
  });

  it('cria corretor com documentos e notifica admins', async () => {
    txMock.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 2002, affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await createBrokerAccountAdmin({
      body: {
        name: 'Corretor Teste',
        email: 'broker@test.com',
        phone: '(64) 98888-1111',
        creci: '12345-A',
        street: 'Rua B',
        number: '20',
        bairro: 'Centro',
        city: 'Rio Verde',
        state: 'GO',
        cep: '75900000',
        password: '123456',
        status: 'approved',
      },
      files: {
        creciFront: [{ buffer: Buffer.from('a'), mimetype: 'image/jpeg', originalname: 'a.jpg' } as any],
        creciBack: [{ buffer: Buffer.from('b'), mimetype: 'image/jpeg', originalname: 'b.jpg' } as any],
        selfie: [{ buffer: Buffer.from('c'), mimetype: 'image/jpeg', originalname: 'c.jpg' } as any],
      },
    });

    expect(result).toMatchObject({
      message: 'Corretor criado com sucesso.',
      broker_id: 2002,
    });
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(3);
    expect(notifyAdminsMock).toHaveBeenCalledWith(
      "Novo corretor 'Corretor Teste' cadastrado com status 'approved'.",
      'broker',
      2002
    );
  });

  it('rejects broker without mandatory documents', async () => {
    await expect(
      createBrokerAccountAdmin({
        body: {
          name: 'Corretor Teste',
          email: 'broker@test.com',
          phone: '(64) 98888-1111',
          creci: '12345-A',
          street: 'Rua B',
          number: '20',
          bairro: 'Centro',
          city: 'Rio Verde',
          state: 'GO',
          cep: '75900000',
          password: '123456',
        },
        files: {},
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    expect(getConnectionMock).not.toHaveBeenCalled();
  });
});
