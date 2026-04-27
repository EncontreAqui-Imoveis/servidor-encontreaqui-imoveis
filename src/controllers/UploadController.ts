import { Request, Response } from 'express';
import { generateUploadSignature } from '../config/cloudinary';

class UploadController {
  async getSignature(req: Request, res: Response) {
    const { folder } = req.query;
    
    // Default to 'properties' if folder is not provided
    const folderName = typeof folder === 'string' && folder ? folder : 'properties';
    
    // Valid folders to prevent arbitrary folder creation
    const allowedFolders = ['properties', 'videos', 'documents', 'avatars'];
    if (!allowedFolders.includes(folderName)) {
      return res.status(400).json({ error: 'Pasta de upload invalida.' });
    }

    try {
      const signatureData = generateUploadSignature(folderName);
      return res.status(200).json(signatureData);
    } catch (error) {
      console.error('Erro ao gerar assinatura de upload:', error);
      return res.status(500).json({ error: 'Falha ao gerar assinatura de upload.' });
    }
  }
}

export default new UploadController();
