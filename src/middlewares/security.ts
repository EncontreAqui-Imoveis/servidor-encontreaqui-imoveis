import type { NextFunction, Request, Response } from 'express';
import type { CorsOptions } from 'cors';

const ONE_YEAR_IN_SECONDS = 31536000;
const PRODUCTION_FALLBACK_ORIGINS = [
  'https://painel-adm-encontreaquiimoveis.vercel.app',
  'https://site-imobiliario-encoreaqui-7b52iuxz7-ctrshift-pms-projects.vercel.app',
  'https://encontreaquiimoveis.com.br',
  'https://www.encontreaquiimoveis.com.br',
];
const SUPPLEMENTAL_CORS_ENV_KEYS = [
  'PAINELWEB_URL',
  'PANEL_APP_URL',
  'SITE_IMOBILIARIO_URL',
  'SITE_URL',
  'FRONTEND_URL',
  'WEB_APP_URL',
];
const DEFAULT_ALLOWED_CORS_HEADERS = [
  'Authorization',
  'Content-Type',
  'X-Requested-With',
  'X-Request-Id',
  'x-draft-token',
  'X-Draft-Token',
  'x-draft-id',
  'X-Draft-Id',
  /** Confirmação de senha em ações sensíveis (excluir cliente/corretor, etc.) — o browser envia no preflight. */
  'X-Admin-Reauth',
  'Accept',
  'Origin',
  'Cache-Control',
  'Pragma',
  'Baggage',
  'Sentry-Trace',
] as const;

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${protocol}//${host}${port}`;
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
}

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction
) {
  res.setHeader(
    'Strict-Transport-Security',
    `max-age=${ONE_YEAR_IN_SECONDS}; includeSubDomains`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );
  next();
}

export function enforceHttps(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }

  const enforceHttpsInProxy =
    (process.env.ENFORCE_HTTPS ?? '').trim().toLowerCase() === 'true';
  if (!enforceHttpsInProxy) {
    next();
    return;
  }

  if (req.secure) {
    next();
    return;
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === 'https') {
    next();
    return;
  }

  const host = req.headers.host;
  if (!host) {
    res.status(400).json({ error: 'Host ausente para redirecionamento HTTPS.' });
    return;
  }

  res.redirect(308, `https://${host}${req.originalUrl}`);
}

export function buildCorsOptions(): CorsOptions {
  const nodeEnv = String(process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin) => origin.length > 0);
  const supplementalOrigins = SUPPLEMENTAL_CORS_ENV_KEYS
    .map((key) => normalizeOrigin(String(process.env[key] ?? '')))
    .filter((origin) => origin.length > 0);
  const defaultLocalOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'http://localhost:19006',
    'http://127.0.0.1:19006',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  const envLocalOrigins = (process.env.CORS_LOCAL_ORIGINS ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin) => origin.length > 0);
  const mergedConfiguredOrigins = Array.from(
    new Set([
      ...configuredOrigins,
      ...supplementalOrigins,
      ...envLocalOrigins,
      // Sempre incluir domínios de produção do site/painel (evita CORS se NODE_ENV ou CORS_ORIGINS no Railway estiverem incompletos).
      ...PRODUCTION_FALLBACK_ORIGINS,
      ...defaultLocalOrigins,
    ]),
  );
  const allowedOrigins =
    mergedConfiguredOrigins.length > 0
      ? mergedConfiguredOrigins
      : nodeEnv === 'production'
        ? PRODUCTION_FALLBACK_ORIGINS
        : defaultLocalOrigins;
  const allowedOriginSet = new Set(allowedOrigins.map((origin) => normalizeOrigin(origin)));

  if (allowedOrigins.length === 0) {
    return {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [...DEFAULT_ALLOWED_CORS_HEADERS],
      exposedHeaders: ['X-Request-Id'],
      optionsSuccessStatus: 204,
    };
  }

  return {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedRequestOrigin = normalizeOrigin(origin);
      if (
        allowedOriginSet.has(normalizedRequestOrigin) ||
        normalizedRequestOrigin.endsWith('.vercel.app')
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [...DEFAULT_ALLOWED_CORS_HEADERS],
    exposedHeaders: ['X-Request-Id'],
    optionsSuccessStatus: 204,
  };
}
