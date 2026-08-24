import type { Response } from 'express';

import {
  applicationErrorToHttpStatus,
  isApplicationError,
  type ApplicationError,
} from '../errors/ApplicationError';

type AppErrorResponseContext = {
  requestId?: string | null;
};

export function respondWithAppError(
  res: Response,
  error: unknown,
  context: AppErrorResponseContext = {},
): Response {
  if (isApplicationError(error)) {
    return res.status(applicationErrorToHttpStatus(error)).json({
      error: error.message,
      ...(error.details ?? {}),
    });
  }

  // Never send raw driver/SQL messages to the browser. Besides exposing
  // implementation details, those messages are not actionable to an admin
  // and can contain schema/table information. Keep diagnostics server-side.
  const diagnostic = error as {
    name?: unknown;
    code?: unknown;
    errno?: unknown;
    sqlMessage?: unknown;
    message?: unknown;
  };
  console.error('Erro não tratado no controller:', {
    requestId: context.requestId ?? null,
    name: diagnostic?.name,
    code: diagnostic?.code,
    errno: diagnostic?.errno,
    message: diagnostic?.message,
    sqlMessage: diagnostic?.sqlMessage,
  });
  return res.status(500).json({
    error: 'Erro interno do servidor.',
    ...(context.requestId ? { requestId: context.requestId } : {}),
  });
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
