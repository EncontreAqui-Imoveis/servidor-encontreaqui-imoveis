import { v2 as cloudinary } from 'cloudinary';
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
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: `conectimovel/${folder}`,
        resource_type: 'auto',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result!.secure_url,
          public_id: result!.public_id,
        });
      }
    );

    // Convert buffer to stream
    const stream = Readable.from(file.buffer);
    stream.pipe(uploadStream);
  });
};

export default cloudinary;