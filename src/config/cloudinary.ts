import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = (
  file: Express.Multer.File, 
  folder: string
): Promise<{ url: string; public_id: string }> => {
  const targetFolder = `conectimovel/${folder}`;
  const isVideo = (file.mimetype || '').toLowerCase().startsWith('video/');

  if (isVideo) {
    return uploadVideoChunked(file, targetFolder);
  }

  if (file.path) {
    return uploadByPath(file.path, targetFolder);
  }

  return uploadByStream(file, targetFolder);
};

function mapCloudinaryError(error: unknown): Error {
  const cloudinaryError = error as { message?: string; http_code?: number } | undefined;
  if (cloudinaryError?.http_code === 413) {
    const normalized = new Error(
      'Arquivo muito grande para upload. Reduza o tamanho do arquivo e tente novamente.'
    );
    (normalized as Error & { statusCode?: number }).statusCode = 413;
    return normalized;
  }
  return (error as Error) ?? new Error('Falha no upload para o Cloudinary.');
}

function uploadByStream(
  file: Express.Multer.File,
  targetFolder: string
): Promise<{ url: string; public_id: string }> {
  if (!file.buffer || file.buffer.length === 0) {
    return Promise.reject(
      new Error('Arquivo invalido para upload. Conteudo nao encontrado.')
    );
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: targetFolder,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error || !result) {
          return reject(mapCloudinaryError(error));
        }
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
        });
      }
    );

    // Convert buffer to stream
    const stream = Readable.from(file.buffer);
    stream.pipe(uploadStream);
  });
}

async function uploadByPath(
  filePath: string,
  targetFolder: string
): Promise<{ url: string; public_id: string }> {
  try {
    const result = (await cloudinary.uploader.upload(filePath, {
      folder: targetFolder,
      resource_type: 'auto',
    })) as UploadApiResponse;

    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    throw mapCloudinaryError(error);
  } finally {
    await fs.unlink(filePath).catch(() => undefined);
  }
}

async function uploadVideoChunked(
  file: Express.Multer.File,
  targetFolder: string
): Promise<{ url: string; public_id: string }> {
  const hasDiskPath = typeof file.path === 'string' && file.path.length > 0;
  const ext = path.extname(file.originalname || '') || '.mp4';
  const tmpFile =
    hasDiskPath
      ? file.path
      : path.join(os.tmpdir(), `cloudinary-video-${randomUUID()}${ext}`);

  try {
    if (!hasDiskPath) {
      if (!file.buffer || file.buffer.length === 0) {
        throw new Error('Arquivo de video invalido para upload.');
      }
      await fs.writeFile(tmpFile, file.buffer);
    }

    const result = (await cloudinary.uploader.upload_large(tmpFile, {
      folder: targetFolder,
      resource_type: 'video',
      chunk_size: 20 * 1024 * 1024,
    })) as UploadApiResponse;
    return {
      url: result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    throw mapCloudinaryError(error);
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

export default cloudinary;
