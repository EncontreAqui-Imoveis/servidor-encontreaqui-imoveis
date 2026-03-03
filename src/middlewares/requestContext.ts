import { randomUUID } from 'crypto';
import type { Request, RequestHandler } from 'express';

type RequestWithContext = Request & {
  requestId?: string;
  requestStartedAtMs?: number;
};

export function getRequestId(req: Request): string | null {
  const requestId = (req as RequestWithContext).requestId;
  if (typeof requestId === 'string' && requestId.trim().length > 0) {
    return requestId.trim();
  }
  return null;
}

function resolveRequestId(req: Request): string {
  const fromHeader = req.get('x-request-id');
  if (typeof fromHeader === 'string' && fromHeader.trim().length > 0) {
    return fromHeader.trim();
  }
  return randomUUID();
}

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestWithContext = req as RequestWithContext;
  const requestId = resolveRequestId(req);
  const startedAtMs = Date.now();

  requestWithContext.requestId = requestId;
  requestWithContext.requestStartedAtMs = startedAtMs;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const durationMs = Math.max(Date.now() - startedAtMs, 0);
    console.info('HTTP request completed:', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
};
