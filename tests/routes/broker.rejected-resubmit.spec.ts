import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { queryMock, uploadToCloudinaryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  uploadToCloudinaryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/middlewares/auth', () => ({
  authMiddleware: (req: any, _res: any, next: () => void) => {
    req.userId = 30003;
    req.userRole = 'client';
    next();
  },
  isBroker: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../src/middlewares/uploadMiddleware', () => ({
  brokerDocsUpload: {
    fields: () => (req: any, _res: any, next: () => void) => {
      req.files = {
        creciFront: [{ originalname: 'front.jpg', mimetype: 'image/jpeg', size: 128, buffer: Buffer.from('f') }],
        creciBack: [{ originalname: 'back.jpg', mimetype: 'image/jpeg', size: 128, buffer: Buffer.from('b') }],
        selfie: [{ originalname: 'selfie.jpg', mimetype: 'image/jpeg', size: 128, buffer: Buffer.from('s') }],
      };
      next();
    },
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: uploadToCloudinaryMock,
}));

describe('Broker resubmit after rejected', () => {
  let app: express.Express;

  beforeAll(async () => {
    const { default: brokerRoutes } = await import('../../src/routes/broker.routes');
    app = express();
    app.use(express.json());
    app.use('/brokers', brokerRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    uploadToCloudinaryMock
      .mockResolvedValueOnce({ url: 'https://files/front.jpg' })
      .mockResolvedValueOnce({ url: 'https://files/back.jpg' })
      .mockResolvedValueOnce({ url: 'https://files/selfie.jpg' });
  });

  it('allows request-upgrade when broker status is rejected', async () => {
    queryMock
      .mockResolvedValueOnce([[]]) // CRECI dup check
      .mockResolvedValueOnce([[{ status: 'rejected' }]]) // existing broker
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // update brokers
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // update docs

    const response = await request(app).post('/brokers/me/request-upgrade').send({
      creci: '12345678',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'pending_verification',
      role: 'broker',
    });
  });

  it('allows verify-documents upload when broker status is rejected', async () => {
    queryMock
      .mockResolvedValueOnce([[{ status: 'rejected' }]]) // select broker status
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // update rejected -> pending
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // update broker again in non-approved branch
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // upsert broker_documents

    const response = await request(app).post('/brokers/me/verify-documents').send({
      creci: '12345678',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    const updateCalls = queryMock.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE brokers SET creci = ?, status = ? WHERE id = ?')
    );
    expect(updateCalls.length).toBeGreaterThan(0);
  });
});

