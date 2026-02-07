"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToCloudinary = void 0;
const cloudinary_1 = require("cloudinary");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const uploadToCloudinary = (file, folder) => {
    const targetFolder = `conectimovel/${folder}`;
    const isVideo = (file.mimetype || '').toLowerCase().startsWith('video/');
    if (isVideo) {
        return uploadVideoChunked(file, targetFolder);
    }
    return uploadByStream(file, targetFolder);
};
exports.uploadToCloudinary = uploadToCloudinary;
function mapCloudinaryError(error) {
    const cloudinaryError = error;
    if (cloudinaryError?.http_code === 413) {
        const normalized = new Error('Arquivo muito grande para upload. Reduza o tamanho do arquivo e tente novamente.');
        normalized.statusCode = 413;
        return normalized;
    }
    return error ?? new Error('Falha no upload para o Cloudinary.');
}
function uploadByStream(file, targetFolder) {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary_1.v2.uploader.upload_stream({
            folder: targetFolder,
            resource_type: 'auto',
        }, (error, result) => {
            if (error || !result) {
                return reject(mapCloudinaryError(error));
            }
            resolve({
                url: result.secure_url,
                public_id: result.public_id,
            });
        });
        // Convert buffer to stream
        const stream = stream_1.Readable.from(file.buffer);
        stream.pipe(uploadStream);
    });
}
async function uploadVideoChunked(file, targetFolder) {
    const ext = path_1.default.extname(file.originalname || '') || '.mp4';
    const tmpFile = path_1.default.join(os_1.default.tmpdir(), `cloudinary-video-${(0, crypto_1.randomUUID)()}${ext}`);
    try {
        await fs_1.promises.writeFile(tmpFile, file.buffer);
        const result = (await cloudinary_1.v2.uploader.upload_large(tmpFile, {
            folder: targetFolder,
            resource_type: 'video',
            chunk_size: 20 * 1024 * 1024,
        }));
        return {
            url: result.secure_url,
            public_id: result.public_id,
        };
    }
    catch (error) {
        throw mapCloudinaryError(error);
    }
    finally {
        await fs_1.promises.unlink(tmpFile).catch(() => undefined);
    }
}
exports.default = cloudinary_1.v2;
