import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, uploadToCloudinaryMock } = vi.hoisted(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  return {
  queryMock: vi.fn(),
  uploadToCloudinaryMock: vi.fn(),
  };
});

vi.mock('../../src/services/brokerPersistenceService', () => ({
  brokerDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: uploadToCloudinaryMock,
}));

import { brokerController } from '../../src/controllers/BrokerController';

describe('Broker resubmit after rejected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves rejected broker back to pending_verification on request-upgrade', async () => {
    const app = express();
    app.use(express.json());
    app.post('/brokers/me/request-upgrade', (req, res) =>
      brokerController.requestUpgrade(
        { ...req, userId: 77 } as any,
        res,
      ),
    );

    queryMock
      .mockResolvedValueOnce([[]]) // duplicate creci
      .mockResolvedValueOnce([[{ status: 'rejected' }]]) // current status
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // brokers status update
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // broker documents pending

    const response = await request(app)
      .post('/brokers/me/request-upgrade')
      .send({ creci: '12345678' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'pending_verification',
      role: 'broker',
    });
    expect(queryMock).toHaveBeenCalledWith(
      'UPDATE brokers SET creci = ?, status = ? WHERE id = ?',
      ['12345678', 'pending_verification', 77],
    );
    expect(queryMock).toHaveBeenCalledWith(
      'UPDATE broker_documents SET status = ? WHERE broker_id = ?',
      ['pending', 77],
    );
  });

  it('allows rejected broker to upload docs and re-enter pending_verification', async () => {
    const app = express();
    app.use(express.json());
    app.post(
      '/brokers/me/verify-documents',
      (req, _res, next) => {
        (req as any).files = {
          creciFront: [{ path: 'front.png' }],
          creciBack: [{ path: 'back.png' }],
          selfie: [{ path: 'selfie.png' }],
        };
        next();
      },
      (req, res) =>
        brokerController.uploadVerificationDocs(
          { ...req, userId: 77 } as any,
          res,
        ),
    );

    uploadToCloudinaryMock
      .mockResolvedValueOnce({ url: 'https://cloud/front.png' })
      .mockResolvedValueOnce({ url: 'https://cloud/back.png' })
      .mockResolvedValueOnce({ url: 'https://cloud/selfie.png' });

    queryMock
      .mockResolvedValueOnce([[{ status: 'rejected' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // brokers -> pending
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // upsert broker_documents

    const response = await request(app)
      .post('/brokers/me/verify-documents')
      .send({ creci: '12345678' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(
      'UPDATE brokers SET creci = ?, status = ? WHERE id = ?',
      ['12345678', 'pending_verification', 77],
    );
  });
});

