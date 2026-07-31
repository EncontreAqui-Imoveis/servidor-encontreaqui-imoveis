import { createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

type RawBodyRequest = Request & { rawBody?: Buffer };

function headerValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function safeEqual(expected: string, received: string | null): boolean {
  if (!received) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function configuredSecret(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function rejectUnconfigured(res: Response): void {
  res.status(503).json({ error: 'Integração operacional indisponível.' });
}

function rejectUnauthorized(res: Response): void {
  res.status(401).json({ error: 'Acesso não autorizado.' });
}

function validateHmac(
  req: Request,
  secretName: string,
  headerName: string,
  algorithm: 'sha1' | 'sha256',
  acceptedPrefixes: string[],
): 'valid' | 'invalid' | 'unconfigured' {
  const secret = configuredSecret(secretName);
  if (!secret) return 'unconfigured';

  const rawBody = (req as RawBodyRequest).rawBody;
  if (!rawBody) return 'invalid';

  const digest = createHmac(algorithm, secret).update(rawBody).digest('hex');
  const signature = headerValue(req.headers[headerName]);
  const valid = acceptedPrefixes.some((prefix) => safeEqual(`${prefix}${digest}`, signature));
  return valid ? 'valid' : 'invalid';
}

export function captureWebhookRawBody(req: Request, _res: Response, buffer: Buffer): void {
  if (req.originalUrl.startsWith('/admin/dashboard/webhook/')) {
    (req as RawBodyRequest).rawBody = Buffer.from(buffer);
  }
}

export function requireOperationalSecret(secretName: string, headerName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const secret = configuredSecret(secretName);
    if (!secret) {
      // Avoid publishing an operational endpoint when it was not explicitly configured.
      res.sendStatus(404);
      return;
    }

    if (!safeEqual(secret, headerValue(req.headers[headerName]))) {
      rejectUnauthorized(res);
      return;
    }

    next();
  };
}

export function verifyGithubWebhook(req: Request, res: Response, next: NextFunction): void {
  const result = validateHmac(
    req,
    'GITHUB_WEBHOOK_SECRET',
    'x-hub-signature-256',
    'sha256',
    ['sha256='],
  );
  if (result === 'unconfigured') return rejectUnconfigured(res);
  if (result === 'invalid') return rejectUnauthorized(res);
  next();
}

export function verifyVercelWebhook(req: Request, res: Response, next: NextFunction): void {
  const result = validateHmac(
    req,
    'VERCEL_WEBHOOK_SECRET',
    'x-vercel-signature',
    'sha1',
    ['', 'sha1='],
  );
  if (result === 'unconfigured') return rejectUnconfigured(res);
  if (result === 'invalid') return rejectUnauthorized(res);
  next();
}

export function verifyRailwayWebhook(req: Request, res: Response, next: NextFunction): void {
  const secret = configuredSecret('RAILWAY_WEBHOOK_SECRET');
  if (!secret) return rejectUnconfigured(res);

  // Railway's generic project webhook does not document a signed delivery header.
  // Configure its URL with ?token=<RAILWAY_WEBHOOK_SECRET>; a header also works for controlled callers.
  const token = String(req.query.token ?? headerValue(req.headers['x-railway-webhook-secret']) ?? '');
  if (!safeEqual(secret, token)) return rejectUnauthorized(res);
  next();
}
