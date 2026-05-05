import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnectionMock, txMock, deleteCloudinaryAssetMock } = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    getConnectionMock: vi.fn(),
    txMock: tx,
    deleteCloudinaryAssetMock: vi.fn(),
  };
});

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    getConnection: getConnectionMock,
    query: vi.fn(),
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  __esModule: true,
  default: {},
  uploadToCloudinary: vi.fn(),
  deleteCloudinaryAsset: deleteCloudinaryAssetMock,
}));

import { adminController } from '../../src/controllers/AdminController';

describe('DELETE /admin/brokers/:id/documents/:docType', () => {
  const app = express();

  app.delete(
    '/admin/brokers/:id/documents/:docType',
    (req, res) => adminController.deleteBrokerDocument(req as any, res),
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.query.mockReset();
    deleteCloudinaryAssetMock.mockReset();
  });

  it('removes only the selected broker document by setting empty URL (NOT NULL safe)', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [{ creci_front_url: 'https://cdn.example.com/brokers/12/front.jpg' }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const response = await request(app).delete(
      '/admin/brokers/12/documents/creciFront',
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Documento removido com sucesso.');
    expect(deleteCloudinaryAssetMock).toHaveBeenCalledWith({
      url: 'https://cdn.example.com/brokers/12/front.jpg',
      invalidate: true,
    });
    expect(txMock.query).toHaveBeenCalledWith(
      'UPDATE broker_documents SET creci_front_url = ?, status = \'pending\', updated_at = CURRENT_TIMESTAMP WHERE broker_id = ?',
      ['', 12],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
    expect(txMock.rollback).not.toHaveBeenCalled();
  });

  it('returns success when broker document row is absent', async () => {
    txMock.query.mockResolvedValueOnce([[]]);

    const response = await request(app).delete(
      '/admin/brokers/12/documents/selfie',
    );

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Documento removido com sucesso.');
    expect(txMock.query).toHaveBeenCalledTimes(1);
    expect(txMock.commit).toHaveBeenCalledTimes(1);
    expect(txMock.rollback).not.toHaveBeenCalled();
  });
});
