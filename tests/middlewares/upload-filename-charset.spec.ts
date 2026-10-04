import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { contractDocumentUpload } from '../../src/middlewares/uploadMiddleware';
import { globalErrorHandler } from '../../src/middlewares/errorHandler';

describe('multipart filename charset', () => {
  const app = express();
  app.post('/upload', contractDocumentUpload.single('file'), (req, res) => {
    res.status(201).json({ originalFileName: req.file?.originalname });
  });
  app.use(globalErrorHandler);

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

  it('rejeita mais de um campo file na mesma requisição', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('%PDF-1.4 primeiro'), 'primeiro.pdf')
      .attach('file', Buffer.from('%PDF-1.4 segundo'), 'segundo.pdf');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Quantidade de arquivos acima do permitido.');
  });
});
