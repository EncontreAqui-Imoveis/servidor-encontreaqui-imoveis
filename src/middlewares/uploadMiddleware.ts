import multer, { FileFilterCallback } from 'multer';
import path from 'path';

// --- Storage in memory (you can switch to disk/S3 later)
const storage = multer.memoryStorage();

// Accepted types
const allowedImageSubtypes = new Set([
  'jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg+xml'
]);
const allowedVideoMime = new Set([
  'video/mp4',
  'video/quicktime',   // iOS .mov
  'video/x-msvideo',   // .avi
  'video/webm',
  'video/3gpp',        // Android
]);

// Helpers
function getExtLower(filename: string): string {
  return path.extname(filename || '').toLowerCase().replace(/^\./, '');
}

function isAllowedImage(mime: string, originalname: string): boolean {
  const normalized = (mime || '').toLowerCase();
  if (normalized.startsWith('image/')) {
    const subtype = normalized.split('/')[1] ?? '';
    if (allowedImageSubtypes.has(subtype)) return true;
    // Some cameras report odd things like image/pjpeg, image/x-citrix-jpeg, etc.
    // Fall back to extension as a pragmatic check
    const ext = getExtLower(originalname);
    return allowedImageSubtypes.has(ext);
  }
  // When the device sends empty or octet-stream, fall back to extension
  if (!normalized || normalized === 'application/octet-stream') {
    const ext = getExtLower(originalname);
    return allowedImageSubtypes.has(ext);
  }
  return false;
}

function isAllowedVideo(mime: string, originalname: string): boolean {
  const normalized = (mime || '').toLowerCase();
  if (allowedVideoMime.has(normalized)) return true;
  // Fallback by extension for inconsistent devices
  const ext = getExtLower(originalname);
  return ['mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext);
}

// IMPORTANT: Align size limits with the mobile client.
// Front-end permite vídeo até 100MB. Aqui ajustamos o limite global para 110MB.
// (Se quiser limites por campo, use middlewares separados por rota.)
export const mediaUpload = multer({
  storage,
  limits: {
    fileSize: 110 * 1024 * 1024, // aceita vídeos até 100MB com folga
    files: 21,                   // 20 imagens + 1 vídeo
  },
  fileFilter: (req, file, cb: FileFilterCallback) => {
    const field = file.fieldname;
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    console.log(`[upload] field=${field} mimetype=${mime} name=${name}`);

    if (field === 'images' || field === 'images[]' || field.startsWith('images')) {
      if (isAllowedImage(mime, name)) {
        cb(null, true);
      } else {
        cb(new Error('Tipo de imagem nao suportado'));
      }
      return;
    }

    if (field === 'video') {
      if (isAllowedVideo(mime, name)) {
        cb(null, true);
      } else {
        cb(new Error('Tipo de video nao suportado'));
      }
      return;
    }

    cb(new Error('Campo de upload invalido'));
  },
});

// Use este middleware na rota como fields() para aplicar os nomes corretos dos campos
// Exemplo:
// router.post(
//   '/properties',
//   mediaUpload.fields([
//     { name: 'images', maxCount: 20 },
//     { name: 'video',  maxCount: 1  },
//   ]),
//   controller.createProperty,
// );
