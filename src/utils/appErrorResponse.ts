import type { Response } from 'express';

import {
  applicationErrorToHttpStatus,
  isApplicationError,
  type ApplicationError,
} from '../errors/ApplicationError';

export function respondWithAppError(res: Response, error: unknown): Response {
  if (isApplicationError(error)) {
    return res.status(applicationErrorToHttpStatus(error)).json({
      error: error.message,
      ...(error.details ?? {}),
    });
  }

  const fallbackMessage = error instanceof Error ? error.message : 'Erro interno do servidor.';
  return res.status(500).json({ error: fallbackMessage });
}

export function appErrorToResponse(error: ApplicationError): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  return {
    statusCode: applicationErrorToHttpStatus(error),
    body: {
      error: error.message,
      ...(error.details ?? {}),
    },
  };
}
