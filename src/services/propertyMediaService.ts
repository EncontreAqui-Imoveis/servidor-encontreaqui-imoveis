import { deleteCloudinaryAsset, uploadToCloudinary } from "../config/cloudinary";
import { runPropertyQuery } from "./propertyPersistenceService";

export async function persistPropertyImages(propertyId: number, imageUrls: string[]) {
  if (imageUrls.length > 0) {
    const values = imageUrls.map((url) => [propertyId, url]);
    await runPropertyQuery(
      "INSERT INTO property_images (property_id, image_url) VALUES ?",
      [values]
    );
  }
}

export async function uploadPropertyMedia(
  files: Express.Multer.File[] | undefined,
  existingUrls: string[],
  videoValue: unknown,
  videoFile?: Express.Multer.File
): Promise<{ imageUrls: string[]; videoUrl: string | null }> {
  const imageUrls = [...existingUrls];
  for (const file of files ?? []) {
    const uploaded = await uploadToCloudinary(file, "properties");
    imageUrls.push(uploaded.url);
  }

  let videoUrl: string | null =
    videoValue && typeof videoValue === "string" && videoValue.startsWith("http")
      ? videoValue
      : null;

  if (videoFile) {
    const uploadedVideo = await uploadToCloudinary(videoFile, "videos");
    videoUrl = uploadedVideo.url;
  }

  return { imageUrls, videoUrl };
}

export async function cleanupPropertyMediaAssets(
  urls: Array<string | null | undefined>,
  context: string
): Promise<void> {
  for (const rawUrl of urls) {
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (!url) {
      continue;
    }

    try {
      await deleteCloudinaryAsset({ url, invalidate: true });
    } catch (error) {
      console.error(`Erro ao excluir asset do Cloudinary (${context}):`, {
        url,
        error,
      });
    }
  }
}
