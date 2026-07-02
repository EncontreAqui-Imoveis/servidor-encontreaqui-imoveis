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

export function generateUploadSignature(folder: string) {
  const timestamp = Math.round(new Date().getTime() / 1000);
  const targetFolder = `conectimovel/${folder}`;
  
  const signature = cloudinary.utils.api_sign_request({
    timestamp,
    folder: targetFolder,
  }, process.env.CLOUDINARY_API_SECRET!);

  return {
    timestamp,
    signature,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    folder: targetFolder,
  };
}

type CloudinaryResourceType = 'image' | 'video' | 'raw';
export type CloudinaryImagePreset = 'thumb' | 'detail' | 'hero';
type CloudinaryImageTransformOptions = {
  preset?: CloudinaryImagePreset;
  width?: number;
  quality?: number | 'auto';
  crop?: 'limit' | 'fill' | 'fit';
};

export const CLOUDINARY_IMAGE_PRESETS: Record<CloudinaryImagePreset, CloudinaryImageTransformOptions> = {
  thumb: { preset: 'thumb', width: 480, crop: 'limit', quality: 'auto' },
  detail: { preset: 'detail', width: 1200, crop: 'limit', quality: 'auto' },
  hero: { preset: 'hero', width: 1600, crop: 'limit', quality: 'auto' },
};

type DeleteCloudinaryAssetInput = {
  publicId?: string | null;
  url?: string | null;
  resourceType?: string | null;
  invalidate?: boolean;
};

function normalizeResourceType(value: unknown): CloudinaryResourceType | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'image' || normalized === 'video' || normalized === 'raw') {
    return normalized;
  }
  return null;
}

function normalizeCloudinaryHostname(urlValue: string): string {
  return urlValue.replace(/^https:\/\/res\.cloudinary\.co\//i, 'https://res.cloudinary.com/');
}

export function optimizeCloudinaryImageUrl(
  urlValue: string | null | undefined,
  options: CloudinaryImageTransformOptions = {}
): string | null {
  const raw = String(urlValue ?? '').trim();
  if (!raw) {
    return null;
  }

  const normalizedInput = normalizeCloudinaryHostname(raw);

  try {
    const parsed = new URL(normalizedInput);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      return normalizedInput;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const resourceIndex = segments.findIndex(
      (segment, index) =>
        normalizeResourceType(segment) != null && segments[index + 1] === 'upload'
    );

    if (resourceIndex < 0) {
      return normalizedInput;
    }

    const uploadIndex = resourceIndex + 1;
    const afterUpload = segments.slice(uploadIndex + 1);
    const versionIndex = afterUpload.findIndex((segment) => /^v\d+$/i.test(segment));
    const publicIdSegments = versionIndex >= 0 ? afterUpload.slice(versionIndex) : afterUpload;

    const preset = options.preset ? CLOUDINARY_IMAGE_PRESETS[options.preset] : null;
    const effectiveWidth = options.width ?? preset?.width;
    const effectiveCrop = options.crop ?? preset?.crop ?? 'limit';
    const effectiveQuality = options.quality ?? preset?.quality ?? 'auto';

    const transformations = [
      `c_${effectiveCrop}`,
      effectiveWidth ? `w_${Math.round(effectiveWidth)}` : null,
      effectiveQuality != null ? `q_${effectiveQuality}` : 'q_auto',
      'f_auto',
    ].filter(Boolean);

    const rebuiltPath = [
      ...segments.slice(0, uploadIndex + 1),
      ...transformations,
      ...publicIdSegments,
    ].join('/');

    parsed.pathname = `/${rebuiltPath}`;
    return parsed.toString();
  } catch {
    return normalizedInput;
  }
}

export function getCloudinaryImagePreset(preset: CloudinaryImagePreset): CloudinaryImageTransformOptions {
  return CLOUDINARY_IMAGE_PRESETS[preset];
}

function resolveCloudinaryReferenceFromUrl(urlValue: string): {
  publicId: string;
  resourceType: CloudinaryResourceType | null;
} | null {
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      return null;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    const resourceIndex = segments.findIndex(
      (segment, index) =>
        normalizeResourceType(segment) != null && segments[index + 1] === 'upload'
    );

    if (resourceIndex < 0) {
      return null;
    }

    const resourceType = normalizeResourceType(segments[resourceIndex]);
    const afterUpload = segments.slice(resourceIndex + 2);
    const versionIndex = afterUpload.findIndex((segment) => /^v\d+$/i.test(segment));
    const publicIdSegments = versionIndex >= 0 ? afterUpload.slice(versionIndex + 1) : afterUpload;

    if (publicIdSegments.length === 0) {
      return null;
    }

    const lastSegment = publicIdSegments[publicIdSegments.length - 1] ?? '';
    publicIdSegments[publicIdSegments.length - 1] = decodeURIComponent(lastSegment).replace(
      /\.[^./]+$/,
      ''
    );

    const publicId = publicIdSegments.join('/').trim();
    if (!publicId) {
      return null;
    }

    return {
      publicId,
      resourceType,
    };
  } catch {
    return null;
  }
}

export async function deleteCloudinaryAsset(
  input: DeleteCloudinaryAssetInput
): Promise<{
  deleted: boolean;
  publicId: string | null;
  resourceType: CloudinaryResourceType | null;
}> {
  const directPublicId = String(input.publicId ?? '').trim();
  const directUrl = String(input.url ?? '').trim();
  const resolvedFromUrl = directUrl ? resolveCloudinaryReferenceFromUrl(directUrl) : null;
  const publicId = directPublicId || resolvedFromUrl?.publicId || '';
  const preferredResourceType =
    normalizeResourceType(input.resourceType) ?? resolvedFromUrl?.resourceType ?? null;

  if (!publicId) {
    return {
      deleted: false,
      publicId: null,
      resourceType: preferredResourceType,
    };
  }

  const candidateResourceTypes = Array.from(
    new Set<CloudinaryResourceType>([
      ...(preferredResourceType ? [preferredResourceType] : []),
      'raw',
      'image',
      'video',
    ])
  );

  let lastError: unknown = null;
  for (const resourceType of candidateResourceTypes) {
    try {
      const result = (await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        invalidate: input.invalidate ?? true,
      })) as { result?: string };

      if (result?.result === 'ok') {
        return {
          deleted: true,
          publicId,
          resourceType,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw mapCloudinaryError(lastError);
  }

  return {
    deleted: false,
    publicId,
    resourceType: preferredResourceType,
  };
}

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
          url: optimizeCloudinaryImageUrl(result.secure_url, { preset: 'hero' }) ?? result.secure_url,
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
      url: optimizeCloudinaryImageUrl(result.secure_url, { preset: 'hero' }) ?? result.secure_url,
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
      url: optimizeCloudinaryImageUrl(result.secure_url, { preset: 'hero' }) ?? result.secure_url,
      public_id: result.public_id,
    };
  } catch (error) {
    throw mapCloudinaryError(error);
  } finally {
    await fs.unlink(tmpFile).catch(() => undefined);
  }
}

export default cloudinary;
