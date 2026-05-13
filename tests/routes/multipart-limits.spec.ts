import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { globalErrorHandler } from '../../src/middlewares/errorHandler';
import { brokerDocsUpload, mediaUpload } from '../../src/middlewares/uploadMiddleware';

function createBrokerDocsMediaTestApp() {
  const app = express();
  let reachedHandler = false;

  app.post(
    '/admin/brokers/:id/documents',
    brokerDocsUpload.fields([
      { name: 'creciFront', maxCount: 1 },
      { name: 'creciBack', maxCount: 1 },
      { name: 'selfie', maxCount: 1 },
    ]),
    (_req, res) => {
      reachedHandler = true;
      res.status(201).json({ ok: true });
    }
  );
  app.use(globalErrorHandler);

  return { app, getReached: () => reachedHandler };
}

function createPropertyMediaTestApp(upload: typeof mediaUpload) {
  const app = express();
  let reachedHandler = false;

  app.post(
    '/properties/client',
    upload.fields([
      { name: 'images', maxCount: 20 },
      { name: 'video', maxCount: 1 },
    ]),
    (_req, res) => {
      reachedHandler = true;
      res.status(201).json({ ok: true });
    }
  );
  app.use(globalErrorHandler);

  return { app, getReached: () => reachedHandler };
}

const BASE_MEDIA_ENV = {
  MEDIA_UPLOAD_MAX_FIELDS: process.env.MEDIA_UPLOAD_MAX_FIELDS,
  MEDIA_UPLOAD_MAX_PARTS: process.env.MEDIA_UPLOAD_MAX_PARTS,
};

function restoreMediaUploadEnv() {
  if (BASE_MEDIA_ENV.MEDIA_UPLOAD_MAX_FIELDS === undefined) {
    delete process.env.MEDIA_UPLOAD_MAX_FIELDS;
  } else {
    process.env.MEDIA_UPLOAD_MAX_FIELDS = BASE_MEDIA_ENV.MEDIA_UPLOAD_MAX_FIELDS;
  }

  if (BASE_MEDIA_ENV.MEDIA_UPLOAD_MAX_PARTS === undefined) {
    delete process.env.MEDIA_UPLOAD_MAX_PARTS;
  } else {
    process.env.MEDIA_UPLOAD_MAX_PARTS = BASE_MEDIA_ENV.MEDIA_UPLOAD_MAX_PARTS;
  }
}

async function loadMediaUploadWithLimits(overrides?: {
  fields?: string;
  parts?: string;
}) {
  if (overrides?.fields === undefined) {
    delete process.env.MEDIA_UPLOAD_MAX_FIELDS;
  } else {
    process.env.MEDIA_UPLOAD_MAX_FIELDS = overrides.fields;
  }

  if (overrides?.parts === undefined) {
    delete process.env.MEDIA_UPLOAD_MAX_PARTS;
  } else {
    process.env.MEDIA_UPLOAD_MAX_PARTS = overrides.parts;
  }

  vi.resetModules();
  const uploadModule = await import('../../src/middlewares/uploadMiddleware');
  return uploadModule.mediaUpload;
}

describe('Limites de multipart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreMediaUploadEnv();
  });

  it('retorna erro controlado quando upload de documentos de corretor excede o limite de fields', async () => {
    const { app, getReached } = createBrokerDocsMediaTestApp();

    let req = request(app).post('/admin/brokers/12/documents').attach(
      'creciFront',
      Buffer.from('front-payload'),
      'creci-front.png'
    );

    for (let index = 0; index < 21; index += 1) {
      req = req.field(`compat_field_${index}`, `value-${index}`);
    }

    const response = await req;

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Quantidade de campos acima do permitido.');
    expect(getReached()).toBe(false);
  });

  it('retorna erro controlado quando upload de imóveis excede o limite padrão de fields', async () => {
    vi.resetModules();
    const { mediaUpload } = await import('../../src/middlewares/uploadMiddleware');
    const { app, getReached } = createPropertyMediaTestApp(mediaUpload);

    let req = request(app).post('/properties/client').attach('images', Buffer.from('img-data'), 'imagem.png');

    for (let index = 0; index <= 120; index += 1) {
      req = req.field(`compat_field_${index}`, `value-${index}`);
    }

    const response = await req;

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Quantidade de campos acima do permitido.');
    expect(getReached()).toBe(false);
  });

  it('retorna erro controlado quando partes excedem o limite reduzido via env', async () => {
    const mediaUploadReducedLimits = await loadMediaUploadWithLimits({
      fields: '50',
      parts: '4',
    });
    const { app, getReached } = createPropertyMediaTestApp(mediaUploadReducedLimits);

    let req = request(app).post('/properties/client').attach('images', Buffer.from('img-data'), 'imagem.png');

    for (let index = 0; index < 4; index += 1) {
      req = req.field(`compat_field_${index}`, `value-${index}`);
    }

    const response = await req;

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Quantidade de partes acima do permitido.');
    expect(getReached()).toBe(false);
  });

  it('aceita multipart no limite configurado e alcança handler sem erro de transporte', async () => {
    const mediaUploadReducedLimits = await loadMediaUploadWithLimits({
      fields: '50',
      parts: '4',
    });
    const { app, getReached } = createPropertyMediaTestApp(mediaUploadReducedLimits);

    let req = request(app).post('/properties/client').attach('images', Buffer.from('img-data'), 'imagem.png');

    for (let index = 0; index < 2; index += 1) {
      req = req.field(`compat_field_${index}`, `value-${index}`);
    }

    const response = await req;

    expect(response.status).toBe(201);
    expect(response.body.ok).toBe(true);
    expect(getReached()).toBe(true);
  });
});
