"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractDocumentUpload = exports.contractDraftUpload = exports.signedProposalUpload = exports.brokerDocsUpload = exports.mediaUpload = exports.MEDIA_UPLOAD_DIR = void 0;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ONE_MB_IN_BYTES = 1024 * 1024;
function parsePositiveEnvNumber(name, fallback) {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}
const MAX_MEDIA_FILE_MB = parsePositiveEnvNumber('UPLOAD_MAX_MEDIA_MB', 25);
const MAX_BROKER_DOC_FILE_MB = parsePositiveEnvNumber('UPLOAD_MAX_BROKER_DOC_MB', 5);
const MAX_SIGNED_PROPOSAL_FILE_MB = parsePositiveEnvNumber('UPLOAD_MAX_SIGNED_PROPOSAL_MB', 5);
const MAX_CONTRACT_DRAFT_FILE_MB = parsePositiveEnvNumber('UPLOAD_MAX_CONTRACT_DRAFT_MB', 5);
const MAX_CONTRACT_DOCUMENT_FILE_MB = parsePositiveEnvNumber('UPLOAD_MAX_CONTRACT_DOCUMENT_MB', 5);
exports.MEDIA_UPLOAD_DIR = path_1.default.join(os_1.default.tmpdir(), 'conectimovel-media-upload');
fs_1.default.mkdirSync(exports.MEDIA_UPLOAD_DIR, { recursive: true });
// Large media uploads stay on disk to reduce memory pressure.
const mediaStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, exports.MEDIA_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname || '').toLowerCase();
        cb(null, `${Date.now()}-${(0, crypto_1.randomUUID)()}${ext}`);
    },
});
// Small document uploads can stay in memory for BLOB/PDF flows.
const documentStorage = multer_1.default.memoryStorage();
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
function getExtLower(filename) {
    return path_1.default.extname(filename || '').toLowerCase().replace(/^\./, '');
}
function isAllowedImage(mime, originalname) {
    const normalized = (mime || '').toLowerCase();
    const ext = getExtLower(originalname);
    if (blockedImageMimes.has(normalized) || blockedImageExtensions.has(ext)) {
        return false;
    }
    if (normalized.startsWith('image/')) {
        const subtype = normalized.split('/')[1] ?? '';
        if (allowedImageSubtypes.has(subtype))
            return true;
        return allowedImageSubtypes.has(ext);
    }
    if (!normalized || normalized === 'application/octet-stream') {
        return allowedImageSubtypes.has(ext);
    }
    return false;
}
function isAllowedVideo(mime, originalname) {
    const normalized = (mime || '').toLowerCase();
    if (allowedVideoMime.has(normalized))
        return true;
    const ext = getExtLower(originalname);
    return ['mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext);
}
function isAllowedPdf(mime, originalname) {
    const normalized = (mime || '').toLowerCase();
    const ext = getExtLower(originalname);
    if (normalized === 'application/pdf')
        return true;
    if (!normalized || normalized === 'application/octet-stream') {
        return ext === 'pdf';
    }
    return ext === 'pdf';
}
function isAllowedContractDocument(mime, originalname) {
    return isAllowedPdf(mime, originalname) || isAllowedImage(mime, originalname);
}
exports.mediaUpload = (0, multer_1.default)({
    storage: mediaStorage,
    limits: {
        fileSize: MAX_MEDIA_FILE_MB * ONE_MB_IN_BYTES,
        files: 21,
        fields: 50,
        fieldSize: ONE_MB_IN_BYTES,
        parts: 80,
    },
    fileFilter: (_req, file, cb) => {
        const field = file.fieldname;
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        if (field === 'images' || field === 'images[]' || field.startsWith('images')) {
            if (isAllowedImage(mime, name)) {
                cb(null, true);
            }
            else {
                cb(new Error('Formato de arquivo nao suportado. Use apenas JPG, PNG ou WEBP.'));
            }
            return;
        }
        if (field === 'video') {
            if (isAllowedVideo(mime, name)) {
                cb(null, true);
            }
            else {
                cb(new Error('Tipo de video nao suportado.'));
            }
            return;
        }
        cb(new Error('Campo de upload invalido.'));
    },
});
exports.brokerDocsUpload = (0, multer_1.default)({
    storage: documentStorage,
    limits: {
        fileSize: MAX_BROKER_DOC_FILE_MB * ONE_MB_IN_BYTES,
        files: 3,
        fields: 20,
        fieldSize: 256 * 1024,
        parts: 30,
    },
    fileFilter: (_req, file, cb) => {
        const field = file.fieldname;
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        const allowedFields = ['crecifront', 'creciback', 'selfie'];
        if (allowedFields.includes(field.toLowerCase())) {
            if (isAllowedImage(mime, name)) {
                cb(null, true);
            }
            else {
                cb(new Error('Formato de arquivo nao suportado. Use apenas JPG, PNG ou WEBP.'));
            }
            return;
        }
        cb(new Error(`Campo de upload invalido para documentos: ${field}`));
    },
});
exports.signedProposalUpload = (0, multer_1.default)({
    storage: documentStorage,
    limits: {
        fileSize: MAX_SIGNED_PROPOSAL_FILE_MB * ONE_MB_IN_BYTES,
        files: 1,
        fields: 10,
        fieldSize: 128 * 1024,
        parts: 20,
    },
    fileFilter: (_req, file, cb) => {
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        if (isAllowedPdf(mime, name)) {
            cb(null, true);
            return;
        }
        cb(new Error('Arquivo invalido. Envie apenas PDF assinado.'));
    },
});
exports.contractDraftUpload = (0, multer_1.default)({
    storage: documentStorage,
    limits: {
        fileSize: MAX_CONTRACT_DRAFT_FILE_MB * ONE_MB_IN_BYTES,
        files: 1,
        fields: 10,
        fieldSize: 128 * 1024,
        parts: 20,
    },
    fileFilter: (_req, file, cb) => {
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        if (isAllowedPdf(mime, name)) {
            cb(null, true);
            return;
        }
        cb(new Error('Arquivo invalido. Envie apenas PDF da minuta.'));
    },
});
exports.contractDocumentUpload = (0, multer_1.default)({
    storage: documentStorage,
    limits: {
        fileSize: MAX_CONTRACT_DOCUMENT_FILE_MB * ONE_MB_IN_BYTES,
        files: 1,
        fields: 10,
        fieldSize: 128 * 1024,
        parts: 20,
    },
    fileFilter: (_req, file, cb) => {
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        if (isAllowedContractDocument(mime, name)) {
            cb(null, true);
            return;
        }
        cb(new Error('Formato de arquivo nao suportado. Use apenas PDF, JPG, JPEG, PNG ou WEBP.'));
    },
});
