"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.brokerDocsUpload = exports.mediaUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
// --- Storage in memory (you can switch to disk/S3 later)
const storage = multer_1.default.memoryStorage();
// Accepted types
const allowedImageSubtypes = new Set([
    'jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg+xml'
]);
const allowedVideoMime = new Set([
    'video/mp4',
    'video/quicktime', // iOS .mov
    'video/x-msvideo', // .avi
    'video/webm',
    'video/3gpp', // Android
]);
// Helpers
function getExtLower(filename) {
    return path_1.default.extname(filename || '').toLowerCase().replace(/^\./, '');
}
function isAllowedImage(mime, originalname) {
    const normalized = (mime || '').toLowerCase();
    if (normalized.startsWith('image/')) {
        const subtype = normalized.split('/')[1] ?? '';
        if (allowedImageSubtypes.has(subtype))
            return true;
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
function isAllowedVideo(mime, originalname) {
    const normalized = (mime || '').toLowerCase();
    if (allowedVideoMime.has(normalized))
        return true;
    // Fallback by extension for inconsistent devices
    const ext = getExtLower(originalname);
    return ['mp4', 'mov', 'avi', 'webm', '3gp'].includes(ext);
}
exports.mediaUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 110 * 1024 * 1024, // aceita vídeos até 100MB com folga
        files: 21, // 20 imagens + 1 vídeo
    },
    fileFilter: (req, file, cb) => {
        const field = file.fieldname;
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        console.log(`[upload] field=${field} mimetype=${mime} name=${name}`);
        if (field === 'images' || field === 'images[]' || field.startsWith('images')) {
            if (isAllowedImage(mime, name)) {
                cb(null, true);
            }
            else {
                cb(new Error('Tipo de imagem nao suportado'));
            }
            return;
        }
        if (field === 'video') {
            if (isAllowedVideo(mime, name)) {
                cb(null, true);
            }
            else {
                cb(new Error('Tipo de video nao suportado'));
            }
            return;
        }
        cb(new Error('Campo de upload invalido'));
    },
});
// Middleware específico para documentos de verificação do corretor
exports.brokerDocsUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB para documentos
        files: 3, // frente, verso e selfie
    },
    fileFilter: (req, file, cb) => {
        const field = file.fieldname;
        const mime = (file.mimetype || '').toLowerCase();
        const name = file.originalname || '';
        console.log(`[broker-docs] field=${field} mimetype=${mime} name=${name}`);
        // Campos permitidos para documentos do corretor
        const allowedFields = ['crecifront', 'creciback', 'selfie'];
        if (allowedFields.includes(field.toLowerCase())) {
            if (isAllowedImage(mime, name)) {
                cb(null, true);
            }
            else {
                cb(new Error('Tipo de imagem não suportado para documentos'));
            }
            return;
        }
        cb(new Error(`Campo de upload inválido para documentos: ${field}`));
    },
});
