import cloudinary from '../config/cloudinary';
import {
  InvalidInputError,
  UnavailableError,
} from '../errors/ApplicationError';

const CLOUDINARY_IMAGE_ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg'];
const CLOUDINARY_VIDEO_ALLOWED_FORMATS = ['mp4', 'mov', 'avi', 'webm', '3gp'];
const DIRECT_UPLOAD_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const DIRECT_UPLOAD_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

type ResourceType = 'image' | 'video';

export function buildCloudinarySignature(resourceTypeRaw: unknown): Record<string, unknown> {
  const requestedType =
    typeof resourceTypeRaw === 'string' ? resourceTypeRaw.toLowerCase() : 'image';

  if (requestedType !== 'image' && requestedType !== 'video') {
    throw new InvalidInputError('resource_type inválido. Use image ou video.');
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new UnavailableError('Cloudinary não configurado no servidor.');
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const resourceType = requestedType as ResourceType;
  const folder = resourceType === 'image' ? 'conectimovel/properties/admin' : 'conectimovel/videos';
  const maxFileSize =
    resourceType === 'image' ? DIRECT_UPLOAD_IMAGE_MAX_BYTES : DIRECT_UPLOAD_VIDEO_MAX_BYTES;
  const allowedFormats =
    resourceType === 'image' ? CLOUDINARY_IMAGE_ALLOWED_FORMATS : CLOUDINARY_VIDEO_ALLOWED_FORMATS;
  const paramsToSign: Record<string, string | number> = {
    folder,
    timestamp,
    allowed_formats: allowedFormats.join(','),
  };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
  return {
    apiKey,
    cloudName,
    signature,
    timestamp,
    folder,
    maxFileSize,
    allowedFormats,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
  };
}
