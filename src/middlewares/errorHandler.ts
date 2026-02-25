import type { ErrorRequestHandler, RequestHandler } from 'express';
import multer from 'multer';

import { redactValue } from '../utils/logSanitizer';

type ErrorWithStatus = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
  code?: string;
};

export const notFoundHandler: RequestHandler = (req, res) => {
  return res.status(404).json({
    error: 'Recurso nao encontrado.',
    path: req.originalUrl,
  });
};

export const globalErrorHandler: ErrorRequestHandler = (
  err: unknown,
  req,
  res,
  next
) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const normalized = (err ?? new Error('Erro desconhecido')) as ErrorWithStatus;
  const method = req.method;
  const path = req.originalUrl;

  if (normalized.type === 'entity.too.large' || normalized.status === 413) {
    console.error('Payload too large:', redactValue({ method, path, message: normalized.message }));
    res.status(413).json({ error: 'Payload muito grande. Reduza o tamanho da requisicao.' });
    return;
  }

  if (normalized instanceof SyntaxError && 'body' in normalized) {
    console.error('Invalid JSON payload:', redactValue({ method, path, message: normalized.message }));
    res.status(400).json({ error: 'JSON invalido na requisicao.' });
    return;
  }

  if (normalized instanceof multer.MulterError) {
    const multerMessageByCode: Record<string, string> = {
      LIMIT_FILE_SIZE: 'Arquivo muito grande para upload.',
      LIMIT_FILE_COUNT: 'Quantidade de arquivos acima do permitido.',
      LIMIT_PART_COUNT: 'Quantidade de partes acima do permitido.',
      LIMIT_FIELD_KEY: 'Nome de campo invalido no upload.',
      LIMIT_FIELD_VALUE: 'Campo de upload com valor muito grande.',
      LIMIT_FIELD_COUNT: 'Quantidade de campos acima do permitido.',
      LIMIT_UNEXPECTED_FILE: 'Campo de upload nao permitido.',
    };
    const status = normalized.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message =
      multerMessageByCode[normalized.code] ?? 'Erro de validacao no upload.';

    console.error(
      'Multer validation error:',
      redactValue({
        method,
        path,
        code: normalized.code,
        message: normalized.message,
      })
    );
    res.status(status).json({ error: message });
    return;
  }

  const statusCode =
    Number.isInteger(normalized.statusCode) && (normalized.statusCode as number) >= 400
      ? (normalized.statusCode as number)
      : Number.isInteger(normalized.status) && (normalized.status as number) >= 400
        ? (normalized.status as number)
        : 500;

  console.error(
    'Unhandled application error:',
    redactValue({
      method,
      path,
      statusCode,
      name: normalized.name,
      message: normalized.message,
      code: normalized.code,
    })
  );

  if (statusCode >= 500) {
    res.status(500).json({ error: 'Erro interno do servidor.' });
    return;
  }

  res.status(statusCode).json({ error: normalized.message || 'Erro na requisicao.' });
};

