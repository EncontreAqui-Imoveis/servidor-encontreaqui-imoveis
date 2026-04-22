import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiSignRequestMock } = vi.hoisted(() => ({
  apiSignRequestMock: vi.fn(),
}));

vi.mock('../../src/config/cloudinary', () => ({
  __esModule: true,
  default: {
    utils: {
      api_sign_request: apiSignRequestMock,
    },
  },
  deleteCloudinaryAsset: vi.fn(),
  uploadToCloudinary: vi.fn(),
}));

import { adminController } from '../../src/controllers/AdminController';

describe('POST /admin/uploads/sign', () => {
  const app = express();
  app.use(express.json());
  app.post('/admin/uploads/sign', (req, res) =>
    adminController.signCloudinaryUpload(req as any, res)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = 'demo-key';
    process.env.CLOUDINARY_API_SECRET = 'demo-secret';
    apiSignRequestMock.mockReturnValue('signed-token');
  });

  it('assina upload de imagem sem max_file_size no payload assinado', async () => {
    const response = await request(app)
      .post('/admin/uploads/sign')
      .send({ resource_type: 'image' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        apiKey: 'demo-key',
        cloudName: 'demo-cloud',
        signature: 'signed-token',
        folder: 'conectimovel/properties/admin',
        maxFileSize: 15 * 1024 * 1024,
        allowedFormats: expect.arrayContaining(['jpg', 'jpeg', 'png', 'webp']),
        resourceType: 'image',
      })
    );

    expect(apiSignRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'conectimovel/properties/admin',
        allowed_formats: expect.any(String),
        timestamp: expect.any(Number),
      }),
      'demo-secret'
    );

    const [signedPayload] = apiSignRequestMock.mock.calls[0] as [Record<string, unknown>, string];
    expect(signedPayload.max_file_size).toBeUndefined();
  });
});
