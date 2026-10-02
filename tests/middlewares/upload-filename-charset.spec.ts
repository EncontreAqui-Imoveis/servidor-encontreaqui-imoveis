import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { contractDocumentUpload } from '../../src/middlewares/uploadMiddleware';

describe('multipart filename charset', () => {
  const app = express();
  app.post('/upload', contractDocumentUpload.single('file'), (req, res) => {
    res.status(201).json({ originalFileName: req.file?.originalname });
  });

  it.each([
    'Reposição.pdf',
    'Certidão de Estado Civil.pdf',
    'João da Silva.pdf',
    'arquivo_normal.pdf',
  ])('preserva filename UTF-8 recebido: %s', async (filename) => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.4'), filename);

    expect(response.status).toBe(201);
    expect(response.body.originalFileName).toBe(filename);
  });
});
