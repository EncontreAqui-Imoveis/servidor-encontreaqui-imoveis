"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadToCloudinary = void 0;
const cloudinary_1 = require("cloudinary");
const stream_1 = require("stream");
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
const uploadToCloudinary = (file, folder) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary_1.v2.uploader.upload_stream({
            folder: `conectimovel/${folder}`,
            resource_type: 'auto',
        }, (error, result) => {
            if (error)
                return reject(error);
            resolve({
                url: result.secure_url,
                public_id: result.public_id,
            });
        });
        // Convert buffer to stream
        const stream = stream_1.Readable.from(file.buffer);
        stream.pipe(uploadStream);
    });
};
exports.uploadToCloudinary = uploadToCloudinary;
exports.default = cloudinary_1.v2;
