import type { Request } from 'express';

const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;
const NUMERIC_SEGMENT = /\/\d+(?=\/|$)/g;
const LONG_TOKEN_SEGMENT = /\/[A-Za-z0-9_-]{16,}(?=\/|$)/g;

function joinRoute(baseUrl: string, routePath: string): string {
  const base = baseUrl === '/' ? '' : baseUrl.replace(/\/$/, '');
  const path = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${base}${path}` || '/';
}

function resolveMountedPrefix(originalUrl: string | undefined, routePath: string): string {
  const originalPath = String(originalUrl ?? '').split('?')[0];
  const originalSegments = originalPath.split('/').filter(Boolean);
  const routeSegments = routePath.split('/').filter(Boolean);
  if (routeSegments.length === 0 || originalSegments.length < routeSegments.length) {
    return '';
  }

  const prefixSegments = originalSegments.slice(0, originalSegments.length - routeSegments.length);
  return prefixSegments.length > 0 ? `/${prefixSegments.join('/')}` : '';
}

/**
 * Produces a bounded-cardinality route label. Query strings and opaque resource
 * identifiers must not become Prometheus labels or operational log content.
 */
export function resolveOperationalRouteLabel(
  req: Pick<Request, 'baseUrl' | 'originalUrl' | 'path' | 'route'>,
): string {
  const matchedPath = req.route?.path;
  if (typeof matchedPath === 'string' && matchedPath.length > 0) {
    const baseUrl = String(req.baseUrl ?? '') || resolveMountedPrefix(req.originalUrl, matchedPath);
    return joinRoute(baseUrl, matchedPath);
  }

  const path = String(req.path ?? '/').split('?')[0] || '/';
  return path
    .replace(UUID_SEGMENT, '/:id')
    .replace(NUMERIC_SEGMENT, '/:id')
    .replace(LONG_TOKEN_SEGMENT, '/:id');
}
