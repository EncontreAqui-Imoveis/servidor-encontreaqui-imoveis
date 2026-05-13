import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { getConnectionMock, txMock, uploadToCloudinaryMock } = vi.hoisted(() => {
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
    uploadToCloudinaryMock: vi.fn(),
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
  uploadToCloudinary: uploadToCloudinaryMock,
  deleteCloudinaryAsset: vi.fn(),
}));
vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 30003;
    req.userRole = 'admin';
    next();
  },
  isAdmin: (_req: any, _res: any, next: () => void) => next(),
  isBroker: (_req: any, _res: any, next: () => void) => next(),
}));

import { adminController } from '../../src/controllers/AdminController';

describe('POST /admin/brokers/:id/documents', () => {
  const app = express();
  const multipartApp = express();
  app.use(express.json());
  app.post(
    '/admin/brokers/:id/documents',
    (req, res, next) => {
      const files = (req.body._files as Record<string, Array<{ path: string }>>) || {};
      (req as any).files = files;
      next();
    },
    adminController.uploadBrokerDocuments,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    txMock.query.mockReset();
  });

  beforeAll(async () => {
    const { default: adminRoutes } = await import('../../src/routes/admin.routes');
    multipartApp.use(express.json());
    multipartApp.use('/admin', adminRoutes);
  });

  it('reenvia apenas a frente do CRECI usando valores existentes para preservar fluxo parcial', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([
        [{ creci_front_url: '', creci_back_url: 'https://cdn/brokers/12/back.jpg', selfie_url: 'https://cdn/brokers/12/selfie.jpg' }],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    uploadToCloudinaryMock.mockResolvedValueOnce({
      url: 'https://cdn/brokers/12/new-front.jpg',
    });

    const response = await request(app)
      .post('/admin/brokers/12/documents')
      .send({
        _files: {
          creciFront: [{ path: 'front.png' }],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Documentos atualizados com sucesso.');
    expect(txMock.query).toHaveBeenCalledWith(
      'SELECT creci_front_url, creci_back_url, selfie_url FROM broker_documents WHERE broker_id = ?',
      [12],
    );
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)'),
      [12, 'https://cdn/brokers/12/new-front.jpg', 'https://cdn/brokers/12/back.jpg', 'https://cdn/brokers/12/selfie.jpg'],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('faz upload parcial sem quebrar NOT NULL e preenche colunas ausentes com string vazia quando falta histórico', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    uploadToCloudinaryMock.mockResolvedValueOnce({
      url: 'https://cdn/brokers/12/new-front.jpg',
    });

    const response = await request(app)
      .post('/admin/brokers/12/documents')
      .send({
        _files: {
          creciFront: [{ path: 'front.png' }],
        },
      });

    expect(response.status).toBe(200);
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)'),
      [12, expect.any(String), '', ''],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('faz upload completo de documentos corretamente', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    uploadToCloudinaryMock
      .mockResolvedValueOnce({ url: 'https://cdn/brokers/12/front.jpg' })
      .mockResolvedValueOnce({ url: 'https://cdn/brokers/12/back.jpg' })
      .mockResolvedValueOnce({ url: 'https://cdn/brokers/12/selfie.jpg' });

    const response = await request(app)
      .post('/admin/brokers/12/documents')
      .send({
        _files: {
          creciFront: [{ path: 'front.png' }],
          creciBack: [{ path: 'back.png' }],
          selfie: [{ path: 'selfie.png' }],
        },
      });

    expect(response.status).toBe(200);
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(3);
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)'),
      [
        12,
        'https://cdn/brokers/12/front.jpg',
        'https://cdn/brokers/12/back.jpg',
        'https://cdn/brokers/12/selfie.jpg',
      ],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('faz upload real com 1 arquivo usando multipart e preserva NOT NULL com string vazia nos faltantes', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    uploadToCloudinaryMock.mockResolvedValueOnce({
      url: 'https://cdn.brokers/12/new-front.jpg',
    });

    const response = await request(multipartApp)
      .post('/admin/brokers/12/documents')
      .attach('creciFront', Buffer.from('front'), 'creci-front.png');

    expect(response.status).toBe(200);
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(1);
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)'),
      [12, expect.any(String), '', ''],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('faz upload real com 2 arquivos e preenche NOT NULL remanescente com string vazia', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    uploadToCloudinaryMock
      .mockResolvedValueOnce({ url: 'https://cdn.brokers/12/new-front.jpg' })
      .mockResolvedValueOnce({ url: 'https://cdn.brokers/12/new-back.jpg' });

    const response = await request(multipartApp)
      .post('/admin/brokers/12/documents')
      .attach('creciFront', Buffer.from('front'), 'creci-front.png')
      .attach('creciBack', Buffer.from('back'), 'creci-back.png');

    expect(response.status).toBe(200);
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(2);
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)'),
      [12, 'https://cdn.brokers/12/new-front.jpg', 'https://cdn.brokers/12/new-back.jpg', ''],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('faz upload real com 3 arquivos e atualiza os 3 campos', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 12 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    uploadToCloudinaryMock
      .mockResolvedValueOnce({ url: 'https://cdn.brokers/12/new-front.jpg' })
      .mockResolvedValueOnce({ url: 'https://cdn.brokers/12/new-back.jpg' })
      .mockResolvedValueOnce({ url: 'https://cdn.brokers/12/new-selfie.jpg' });

    const response = await request(multipartApp)
      .post('/admin/brokers/12/documents')
      .attach('creciFront', Buffer.from('front'), 'creci-front.png')
      .attach('creciBack', Buffer.from('back'), 'creci-back.png')
      .attach('selfie', Buffer.from('selfie'), 'selfie.png');

    expect(response.status).toBe(200);
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(3);
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)'),
      [
        12,
        'https://cdn.brokers/12/new-front.jpg',
        'https://cdn.brokers/12/new-back.jpg',
        'https://cdn.brokers/12/new-selfie.jpg',
      ],
    );
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });
});
