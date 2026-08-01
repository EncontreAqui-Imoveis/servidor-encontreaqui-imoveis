import { randomUUID } from 'crypto';
import type { Request, RequestHandler } from 'express';
import { resolveOperationalRouteLabel } from '../utils/operationalRouteLabel';

type RequestWithContext = Request & {
  requestId?: string;
  requestStartedAtMs?: number;
};

type RequestWithOperationalRole = RequestWithContext & {
  userRole?: string;
  adminRole?: string;
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
    const route = resolveOperationalRouteLabel(req);
    console.info('HTTP request completed:', {
      requestId,
      method: req.method,
      route,
      statusCode: res.statusCode,
      durationMs,
    });

    const securityEvent = res.statusCode === 401
      ? 'authentication_denied'
      : res.statusCode === 403
        ? 'authorization_denied'
        : res.statusCode === 429
          ? 'rate_limited'
          : res.statusCode >= 500
            ? 'server_error'
            : null;

    if (securityEvent) {
      const requestWithRole = req as RequestWithOperationalRole;
      console.warn('Operational security event:', {
        requestId,
        event: securityEvent,
        method: req.method,
        route,
        statusCode: res.statusCode,
        actorRole: requestWithRole.userRole ?? null,
        adminRole: requestWithRole.adminRole ?? null,
      });
    }
  });

  next();
};
