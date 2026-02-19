import multer, { FileFilterCallback } from 'multer';
import path from 'path';

// --- Storage in memory (you can switch to disk/S3 later)
const storage = multer.memoryStorage();

// Accepted types
const allowedImageSubtypes = new Set(['jpeg', 'jpg', 'png', 'webp']);
const blockedImageMimes = new Set(['image/svg+xml', 'image/gif']);
const blockedImageExtensions = new Set(['svg', 'svgz', 'gif']);
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
  const ext = getExtLower(originalname);

  if (blockedImageMimes.has(normalized) || blockedImageExtensions.has(ext)) {
    return false;
  }

  if (normalized.startsWith('image/')) {
    const subtype = normalized.split('/')[1] ?? '';
    if (allowedImageSubtypes.has(subtype)) return true;
    return allowedImageSubtypes.has(ext);
  }
  // When the device sends empty or octet-stream, fall back to extension
  if (!normalized || normalized === 'application/octet-stream') {
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

function isAllowedPdf(mime: string, originalname: string): boolean {
  const normalized = (mime || '').toLowerCase();
  const ext = getExtLower(originalname);
  if (normalized === 'application/pdf') return true;
  if (!normalized || normalized === 'application/octet-stream') {
    return ext === 'pdf';
  }
  return ext === 'pdf';
}

function isAllowedContractDocument(mime: string, originalname: string): boolean {
  return isAllowedPdf(mime, originalname) || isAllowedImage(mime, originalname);
}

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
        cb(new Error('Formato de arquivo não suportado. Use apenas JPG, PNG ou WEBP.'));
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

export const brokerDocsUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, 
    files: 3, 
  },
  fileFilter: (req, file, cb: FileFilterCallback) => {
    const field = file.fieldname;
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    console.log(`[broker-docs] field=${field} mimetype=${mime} name=${name}`);

    const allowedFields = ['crecifront', 'creciback', 'selfie'];
    
    if (allowedFields.includes(field.toLowerCase())) {
      if (isAllowedImage(mime, name)) {
        cb(null, true);
      } else {
        cb(new Error('Formato de arquivo não suportado. Use apenas JPG, PNG ou WEBP.'));
      }
      return;
    }

    cb(new Error(`Campo de upload inválido para documentos: ${field}`));
  },
});

export const signedProposalUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    if (isAllowedPdf(mime, name)) {
      cb(null, true);
      return;
    }

    cb(new Error('Arquivo inválido. Envie apenas PDF assinado.'));
  },
});

export const contractDraftUpload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    if (isAllowedPdf(mime, name)) {
      cb(null, true);
      return;
    }

    cb(new Error('Arquivo inválido. Envie apenas PDF da minuta.'));
  },
});

export const contractDocumentUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    if (isAllowedContractDocument(mime, name)) {
      cb(null, true);
      return;
    }

    cb(
      new Error(
        'Formato de arquivo não suportado. Use apenas PDF, JPG, JPEG, PNG ou WEBP.'
      )
    );
  },
});
