import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvalidInputError,
  NotFoundError,
  PayloadTooLargeError,
} from '../../src/errors/ApplicationError';

const { queryMock, uploadToCloudinaryMock, cleanupPropertyMediaAssetsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  uploadToCloudinaryMock: vi.fn(),
  cleanupPropertyMediaAssetsMock: vi.fn(),
}));

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: uploadToCloudinaryMock,
}));

vi.mock('../../src/services/propertyMediaService', () => ({
  cleanupPropertyMediaAssets: cleanupPropertyMediaAssetsMock,
}));

import {
  addPropertyImageAdmin,
  addPropertyVideoAdmin,
  deletePropertyImageAdmin,
  deletePropertyVideoAdmin,
} from '../../src/services/adminPropertyMediaService';

describe('adminPropertyMediaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadToCloudinaryMock.mockResolvedValue({ url: 'https://cdn.example.com/image-1.webp' });
    cleanupPropertyMediaAssetsMock.mockResolvedValue(undefined);
  });

  it('adiciona imagens ao imóvel e retorna as urls inseridas', async () => {
    queryMock
      .mockResolvedValueOnce([[{ id: 1 }], []])
      .mockResolvedValueOnce([[{ total: 1 }], []])
      .mockResolvedValueOnce([undefined, { affectedRows: 2 }])
      .mockResolvedValueOnce([[{ id: 11, image_url: 'https://cdn.example.com/image-1.webp' }], []]);

    const result = await addPropertyImageAdmin(10, [{} as Express.Multer.File]);

    expect(result.message).toBe('Imagens adicionadas com sucesso.');
    expect(result.images).toEqual([
      { id: 11, url: 'https://cdn.example.com/image-1.webp' },
    ]);
    expect(uploadToCloudinaryMock).toHaveBeenCalledTimes(1);
  });

  it('remove imagem mantendo cleanup do asset anterior', async () => {
    queryMock
      .mockResolvedValueOnce([[{ image_url: 'https://cdn.example.com/old-image.webp' }], []])
      .mockResolvedValueOnce([[{ total: 2 }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await deletePropertyImageAdmin(10, 99);

    expect(result.message).toBe('Imagem removida com sucesso.');
    expect(cleanupPropertyMediaAssetsMock).toHaveBeenCalledWith(
      ['https://cdn.example.com/old-image.webp'],
      'admin_delete_property_image'
    );
  });

  it('remove vídeo existente do imóvel e limpa asset anterior', async () => {
    queryMock
      .mockResolvedValueOnce([[{ video_url: 'https://cdn.example.com/old-video.mp4' }], []])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await deletePropertyVideoAdmin(33);

    expect(result.message).toBe('Video removido com sucesso.');
    expect(cleanupPropertyMediaAssetsMock).toHaveBeenCalledWith(
      ['https://cdn.example.com/old-video.mp4'],
      'admin_delete_property_video'
    );
  });

  it('lança erro quando upload de imagem passa do tamanho permitido', async () => {
    queryMock.mockResolvedValueOnce([[{ id: 1 }], []]).mockResolvedValueOnce([[{ total: 0 }], []]);
    uploadToCloudinaryMock.mockRejectedValueOnce({ statusCode: 413 });

    await expect(addPropertyImageAdmin(10, [{} as Express.Multer.File])).rejects.toBeInstanceOf(
      PayloadTooLargeError,
    );
  });

  it('lança erro quando o imóvel não existe ao adicionar vídeo', async () => {
    queryMock.mockResolvedValueOnce([[], []]);

    await expect(addPropertyVideoAdmin(33, {} as Express.Multer.File)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('lança erro de entrada inválida quando identificador é inválido', async () => {
    await expect(addPropertyImageAdmin(Number.NaN, [] as Express.Multer.File[])).rejects.toBeInstanceOf(
      InvalidInputError,
    );
  });
});
