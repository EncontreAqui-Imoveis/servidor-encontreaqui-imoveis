import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getConnectionMock,
  queryMock,
  txMock,
  deleteCloudinaryAssetMock,
} = vi.hoisted(() => {
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
    deleteCloudinaryAssetMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    getConnection: getConnectionMock,
    query: queryMock,
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  deleteCloudinaryAsset: deleteCloudinaryAssetMock,
}));

import {
  BROKER_DOCUMENT_ASSET_DELETE_FAILED,
  BrokerVerificationDocumentDeletionError,
  removeBrokerVerificationDocuments,
} from '../../src/services/brokerVerificationDocumentDeletionService';

type Documents = {
  broker_id: number;
  creci_front_url: string | null;
  creci_back_url: string | null;
  selfie_url: string | null;
};

function documents(overrides: Partial<Documents> = {}): Documents {
  return {
    broker_id: 42,
    creci_front_url: 'https://res.cloudinary.com/demo/image/upload/v1/brokers/documents/front.jpg',
    creci_back_url: 'https://res.cloudinary.com/demo/image/upload/v1/brokers/documents/back.jpg',
    selfie_url: 'https://res.cloudinary.com/demo/image/upload/v1/brokers/documents/selfie.jpg',
    ...overrides,
  };
}

function arrangeDocuments(initial: Documents | null, current: Documents | null = initial): void {
  queryMock.mockResolvedValue([initial ? [initial] : []]);
  txMock.query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT broker_id')) {
      return [current ? [current] : []];
    }
    return [{ affectedRows: 1 }];
  });
}

describe('removeBrokerVerificationDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    deleteCloudinaryAssetMock.mockResolvedValue({ deleted: true });
  });

  it('remove os três assets e a linha de documentos', async () => {
    const row = documents();
    arrangeDocuments(row);

    await expect(removeBrokerVerificationDocuments(42)).resolves.toEqual({ removed: true });

    expect(deleteCloudinaryAssetMock).toHaveBeenCalledTimes(3);
    expect(deleteCloudinaryAssetMock).toHaveBeenNthCalledWith(1, {
      url: row.creci_front_url,
      invalidate: true,
    });
    expect(deleteCloudinaryAssetMock).toHaveBeenNthCalledWith(2, {
      url: row.creci_back_url,
      invalidate: true,
    });
    expect(deleteCloudinaryAssetMock).toHaveBeenNthCalledWith(3, {
      url: row.selfie_url,
      invalidate: true,
    });
    expect(txMock.query).toHaveBeenCalledWith(
      'DELETE FROM broker_documents WHERE broker_id = ?',
      [42],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('considera inexistência da linha como sucesso idempotente', async () => {
    arrangeDocuments(null);

    await expect(removeBrokerVerificationDocuments(42)).resolves.toEqual({ removed: false });

    expect(deleteCloudinaryAssetMock).not.toHaveBeenCalled();
    expect(getConnectionMock).not.toHaveBeenCalled();
  });

  it('ignora URLs vazias e deixa URL inválida para o helper tratar idempotentemente', async () => {
    const row = documents({
      creci_front_url: ' ',
      creci_back_url: 'not-a-cloudinary-url',
      selfie_url: '',
    });
    arrangeDocuments(row);
    deleteCloudinaryAssetMock.mockResolvedValue({ deleted: false, publicId: null });

    await expect(removeBrokerVerificationDocuments(42)).resolves.toEqual({ removed: true });

    expect(deleteCloudinaryAssetMock).toHaveBeenCalledTimes(1);
    expect(deleteCloudinaryAssetMock).toHaveBeenCalledWith({
      url: 'not-a-cloudinary-url',
      invalidate: true,
    });
    expect(txMock.query).toHaveBeenCalledWith(
      'DELETE FROM broker_documents WHERE broker_id = ?',
      [42],
    );
  });

  it('considera asset já inexistente uma remoção idempotente', async () => {
    const row = documents();
    arrangeDocuments(row);
    deleteCloudinaryAssetMock.mockResolvedValue({ deleted: false, publicId: 'already-missing' });

    await expect(removeBrokerVerificationDocuments(42)).resolves.toEqual({ removed: true });
    expect(txMock.query).toHaveBeenCalledWith(
      'DELETE FROM broker_documents WHERE broker_id = ?',
      [42],
    );
  });

  it('mantém a linha para retentativa quando o Cloudinary falha, sem registrar dados sensíveis', async () => {
    const row = documents();
    arrangeDocuments(row);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    deleteCloudinaryAssetMock
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error('provider failure with sensitive-url'));

    await expect(removeBrokerVerificationDocuments(42)).rejects.toMatchObject({
      code: BROKER_DOCUMENT_ASSET_DELETE_FAILED,
    });

    expect(getConnectionMock).not.toHaveBeenCalled();
    expect(txMock.query).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('permite retentativa depois de uma remoção parcial', async () => {
    const row = documents();
    arrangeDocuments(row);
    deleteCloudinaryAssetMock
      .mockResolvedValueOnce({ deleted: true })
      .mockRejectedValueOnce(new Error('temporary provider failure'));

    await expect(removeBrokerVerificationDocuments(42)).rejects.toBeInstanceOf(
      BrokerVerificationDocumentDeletionError,
    );

    deleteCloudinaryAssetMock.mockReset();
    deleteCloudinaryAssetMock
      .mockResolvedValueOnce({ deleted: false, publicId: 'already-removed' })
      .mockResolvedValueOnce({ deleted: true })
      .mockResolvedValueOnce({ deleted: true });

    await expect(removeBrokerVerificationDocuments(42)).resolves.toEqual({ removed: true });
    expect(deleteCloudinaryAssetMock).toHaveBeenCalledTimes(3);
    expect(txMock.query).toHaveBeenCalledWith(
      'DELETE FROM broker_documents WHERE broker_id = ?',
      [42],
    );
  });
});
