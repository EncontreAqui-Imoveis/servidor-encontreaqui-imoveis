import { randomUUID } from 'crypto';
import fs from 'fs';
import multer, { FileFilterCallback } from 'multer';
import os from 'os';
import path from 'path';

const ONE_MB_IN_BYTES = 1024 * 1024;

function parsePositiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const MAX_MEDIA_FILE_MB = parsePositiveEnvNumber('UPLOAD_MAX_MEDIA_MB', 25);
const MAX_BROKER_DOC_FILE_MB = parsePositiveEnvNumber(
  'UPLOAD_MAX_BROKER_DOC_MB',
  5
);
const MAX_SIGNED_PROPOSAL_FILE_MB = parsePositiveEnvNumber(
  'UPLOAD_MAX_SIGNED_PROPOSAL_MB',
  5
);
const MAX_CONTRACT_DRAFT_FILE_MB = parsePositiveEnvNumber(
  'UPLOAD_MAX_CONTRACT_DRAFT_MB',
  5
);
const MAX_CONTRACT_DOCUMENT_FILE_MB = parsePositiveEnvNumber(
  'UPLOAD_MAX_CONTRACT_DOCUMENT_MB',
  5
);

export const MEDIA_UPLOAD_DIR = path.join(
  os.tmpdir(),
  'conectimovel-media-upload'
);
fs.mkdirSync(MEDIA_UPLOAD_DIR, { recursive: true });

// Large media uploads stay on disk to reduce memory pressure.
const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, MEDIA_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${randomUUID()}${ext}`);
  },
});

// Small document uploads can stay in memory for BLOB/PDF flows.
const documentStorage = multer.memoryStorage();

// Accepted types
const allowedImageSubtypes = new Set(['jpeg', 'jpg', 'png', 'webp']);
const blockedImageMimes = new Set(['image/svg+xml', 'image/gif']);
const blockedImageExtensions = new Set(['svg', 'svgz', 'gif']);
const allowedVideoMime = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/3gpp',
]);

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

  if (!normalized || normalized === 'application/octet-stream') {
    return allowedImageSubtypes.has(ext);
  }

  return false;
}

function isAllowedVideo(mime: string, originalname: string): boolean {
  const normalized = (mime || '').toLowerCase();
  if (allowedVideoMime.has(normalized)) return true;
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
  storage: mediaStorage,
  limits: {
    fileSize: MAX_MEDIA_FILE_MB * ONE_MB_IN_BYTES,
    files: 21,
    fields: 50,
    fieldSize: ONE_MB_IN_BYTES,
    parts: 80,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const field = file.fieldname;
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    if (field === 'images' || field === 'images[]' || field.startsWith('images')) {
      if (isAllowedImage(mime, name)) {
        cb(null, true);
      } else {
        cb(new Error('Formato de arquivo nao suportado. Use apenas JPG, PNG ou WEBP.'));
      }
      return;
    }

    if (field === 'video') {
      if (isAllowedVideo(mime, name)) {
        cb(null, true);
      } else {
        cb(new Error('Tipo de video nao suportado.'));
      }
      return;
    }

    cb(new Error('Campo de upload invalido.'));
  },
});

export const brokerDocsUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: MAX_BROKER_DOC_FILE_MB * ONE_MB_IN_BYTES,
    files: 3,
    fields: 20,
    fieldSize: 256 * 1024,
    parts: 30,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const field = file.fieldname;
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    const allowedFields = ['crecifront', 'creciback', 'selfie'];

    if (allowedFields.includes(field.toLowerCase())) {
      if (isAllowedImage(mime, name)) {
        cb(null, true);
      } else {
        cb(new Error('Formato de arquivo nao suportado. Use apenas JPG, PNG ou WEBP.'));
      }
      return;
    }

    cb(new Error(`Campo de upload invalido para documentos: ${field}`));
  },
});

export const signedProposalUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: MAX_SIGNED_PROPOSAL_FILE_MB * ONE_MB_IN_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 128 * 1024,
    parts: 20,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    if (isAllowedPdf(mime, name)) {
      cb(null, true);
      return;
    }

    cb(new Error('Arquivo invalido. Envie apenas PDF assinado.'));
  },
});

export const contractDraftUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: MAX_CONTRACT_DRAFT_FILE_MB * ONE_MB_IN_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 128 * 1024,
    parts: 20,
  },
  fileFilter: (_req, file, cb: FileFilterCallback) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = file.originalname || '';

    if (isAllowedPdf(mime, name)) {
      cb(null, true);
      return;
    }

    cb(new Error('Arquivo invalido. Envie apenas PDF da minuta.'));
  },
});

export const contractDocumentUpload = multer({
  storage: documentStorage,
  limits: {
    fileSize: MAX_CONTRACT_DOCUMENT_FILE_MB * ONE_MB_IN_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 128 * 1024,
    parts: 20,
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
        'Formato de arquivo nao suportado. Use apenas PDF, JPG, JPEG, PNG ou WEBP.'
      )
    );
  },
});
