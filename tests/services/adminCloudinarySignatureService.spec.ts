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

import { buildCloudinarySignature } from '../../src/services/adminCloudinarySignatureService';

describe('adminCloudinarySignatureService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
    process.env.CLOUDINARY_API_KEY = 'demo-key';
    process.env.CLOUDINARY_API_SECRET = 'demo-secret';
    apiSignRequestMock.mockReturnValue('signed-token');
  });

  it('assina upload de imagem com contrato esperado', () => {
    const result = buildCloudinarySignature('image');

    expect(result).toEqual(
      expect.objectContaining({
        apiKey: 'demo-key',
        cloudName: 'demo-cloud',
        signature: 'signed-token',
        folder: 'conectimovel/properties/admin',
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
  });

  it('rejeita resource type invalido', () => {
    expect(() => buildCloudinarySignature('audio')).toThrow('resource_type inválido. Use image ou video.');
  });
});
