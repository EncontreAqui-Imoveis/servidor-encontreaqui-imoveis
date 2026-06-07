import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { uploadToCloudinary } from '../config/cloudinary';
import {
  InternalError,
  InvalidInputError,
  NotFoundError,
  PayloadTooLargeError,
} from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';
import { cleanupPropertyMediaAssets } from './propertyMediaService';

export const ADMIN_MAX_IMAGES_PER_PROPERTY = 20;
const IMAGE_UPLOAD_CONCURRENCY = 4;

async function uploadImagesWithConcurrency(
  files: Express.Multer.File[],
  folder: string,
  concurrency = IMAGE_UPLOAD_CONCURRENCY,
): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  const results: string[] = new Array(files.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= files.length) {
          break;
        }

        try {
          const uploaded = await uploadToCloudinary(files[currentIndex], folder);
          results[currentIndex] = uploaded.url;
        } catch (error) {
          const knownError = error as { statusCode?: number } | null;
          if (knownError?.statusCode === 413) {
            throw new PayloadTooLargeError(
              'Arquivo muito grande. Reduza o tamanho da imagem e tente novamente.',
            );
          }
          throw new InternalError('Ocorreu um erro inesperado no servidor.');
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export async function addPropertyImageAdmin(propertyId: number, files: Express.Multer.File[]) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imovel invalido.');
  }

  if (!files || files.length === 0) {
    throw new InvalidInputError('Nenhuma imagem enviada.');
  }

  const [propertyRows] = await adminDb.query<RowDataPacket[]>(
    'SELECT id FROM properties WHERE id = ?',
    [propertyId],
  );

  if (propertyRows.length === 0) {
    throw new NotFoundError('Imovel nao encontrado.');
  }

  const [imageCountRows] = await adminDb.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM property_images WHERE property_id = ?',
    [propertyId],
  );
  const existingCount = Number(imageCountRows[0]?.total ?? 0);
  const availableSlots = Math.max(0, ADMIN_MAX_IMAGES_PER_PROPERTY - existingCount);

  if (availableSlots <= 0) {
    throw new InvalidInputError(
      `Limite maximo de ${ADMIN_MAX_IMAGES_PER_PROPERTY} imagens por imovel atingido.`,
    );
  }

  if (files.length > availableSlots) {
    throw new InvalidInputError(`Este imovel aceita somente ${availableSlots} nova(s) imagem(ns).`);
  }

  const uploadedUrls = await uploadImagesWithConcurrency(files, 'properties/admin');

  if (uploadedUrls.length > 0) {
    const values = uploadedUrls.map((url) => [propertyId, url]);
    await adminDb.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
  }

  let uploadedImages: Array<{ id: number; url: string }> = [];
  if (uploadedUrls.length > 0) {
    const [uploadedImageRows] = await adminDb.query<RowDataPacket[]>(
      `
          SELECT id, image_url
          FROM property_images
          WHERE property_id = ?
            AND image_url IN (${uploadedUrls.map(() => '?').join(', ')})
          ORDER BY FIELD(image_url, ${uploadedUrls.map(() => '?').join(', ')})
        `,
      [propertyId, ...uploadedUrls, ...uploadedUrls],
    );
    uploadedImages = uploadedImageRows.map((row) => ({
      id: Number(row.id),
      url: String(row.image_url),
    }));
  }

  return { message: 'Imagens adicionadas com sucesso.', images: uploadedImages };
}

export async function deletePropertyImageAdmin(propertyId: number, imageId: number) {
  if (Number.isNaN(propertyId) || Number.isNaN(imageId)) {
    throw new InvalidInputError('Identificadores invalidos.');
  }

  const [imageRows] = await adminDb.query<RowDataPacket[]>(
    'SELECT image_url FROM property_images WHERE id = ? AND property_id = ?',
    [imageId, propertyId],
  );
  const imageUrl =
    typeof imageRows[0]?.image_url === 'string' ? imageRows[0].image_url : null;

  const [imageCountRows] = await adminDb.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM property_images WHERE property_id = ?',
    [propertyId],
  );
  const totalImages = Number(imageCountRows[0]?.total ?? 0);
  if (totalImages <= 1) {
    throw new InvalidInputError('O imóvel precisa manter ao menos 1 imagem.');
  }

  const [result] = await adminDb.query<ResultSetHeader>(
    'DELETE FROM property_images WHERE id = ? AND property_id = ?',
    [imageId, propertyId],
  );

  if (result.affectedRows === 0) {
    throw new NotFoundError('Imagem nao encontrada para este imovel.');
  }

  await cleanupPropertyMediaAssets([imageUrl], 'admin_delete_property_image');
  return { message: 'Imagem removida com sucesso.' };
}

export async function addPropertyVideoAdmin(propertyId: number, file?: Express.Multer.File) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imovel invalido.');
  }

  if (!file) {
    throw new InvalidInputError('Nenhum video enviado.');
  }

  const [propertyRows] = await adminDb.query<RowDataPacket[]>(
    'SELECT id, video_url FROM properties WHERE id = ?',
    [propertyId],
  );

  if (propertyRows.length === 0) {
    throw new NotFoundError('Imovel nao encontrado.');
  }

  const previousVideoUrl =
    typeof propertyRows[0]?.video_url === 'string' ? propertyRows[0].video_url : null;

  let uploaded;
  try {
    uploaded = await uploadToCloudinary(file, 'videos');
  } catch (error) {
    const knownError = error as { statusCode?: number } | null;
    if (knownError?.statusCode === 413) {
      throw new PayloadTooLargeError(
        'Arquivo muito grande. Reduza o tamanho do video e tente novamente.',
      );
    }
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }

  await adminDb.query('UPDATE properties SET video_url = ? WHERE id = ?', [uploaded.url, propertyId]);
  await cleanupPropertyMediaAssets([previousVideoUrl], 'admin_replace_property_video');

  return { message: 'Video adicionado com sucesso.', video: uploaded.url };
}

export async function deletePropertyVideoAdmin(propertyId: number) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imovel invalido.');
  }

  const [propertyRows] = await adminDb.query<RowDataPacket[]>(
    'SELECT video_url FROM properties WHERE id = ?',
    [propertyId],
  );
  const videoUrl =
    typeof propertyRows[0]?.video_url === 'string' ? propertyRows[0].video_url : null;

  const [result] = await adminDb.query<ResultSetHeader>(
    'UPDATE properties SET video_url = NULL WHERE id = ?',
    [propertyId],
  );

  if (result.affectedRows === 0) {
    throw new NotFoundError('Imovel nao encontrado.');
  }

  await cleanupPropertyMediaAssets([videoUrl], 'admin_delete_property_video');
  return { message: 'Video removido com sucesso.' };
}
