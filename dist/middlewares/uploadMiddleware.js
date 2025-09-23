"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaUpload = void 0;
const multer_1 = __importDefault(require("multer"));
const storage = multer_1.default.memoryStorage();
const allowedImageSubtypes = new Set(['jpeg', 'jpg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg+xml']);
const allowedVideoMime = new Set(['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/3gpp']);
exports.mediaUpload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 21,
    },
    fileFilter: (req, file, cb) => {
        const normalizedMime = (file.mimetype ?? '').toLowerCase();
        const { fieldname } = file;
        if (fieldname === 'images') {
            const parts = normalizedMime.split('/');
            const subtype = parts.length > 1 ? parts[1] : normalizedMime;
            if (normalizedMime.startsWith('image/') || allowedImageSubtypes.has(subtype)) {
                cb(null, true);
                return;
            }
            cb(new Error('Tipo de imagem nao suportado'));
            return;
        }
        if (fieldname === 'video') {
            if (allowedVideoMime.has(normalizedMime)) {
                cb(null, true);
                return;
            }
            cb(new Error('Tipo de video nao suportado'));
            return;
        }
        cb(new Error('Campo de upload invalido'));
    },
});
