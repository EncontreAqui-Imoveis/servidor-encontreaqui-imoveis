import { ConnectionOptions } from 'bullmq';

const DEFAULT_REDIS_PORT = 6379;
const nodeEnv = String(process.env.NODE_ENV ?? '').trim().toLowerCase();
const allowLocalFallback = nodeEnv !== 'production';

function normalizePort(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return DEFAULT_REDIS_PORT;
  }
  return parsed;
}

function normalizeHost(value: string | undefined): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized;
}

export function resolveRedisConfig(): {
  config?: ConnectionOptions;
  reason: string;
  source: 'redis_url' | 'legacy_host' | 'missing';
} {
  const rawRedisUrl = String(process.env.REDIS_URL ?? '').trim();
  if (rawRedisUrl) {
    return {
      config: { url: rawRedisUrl },
      reason: 'REDIS_URL configurada',
      source: 'redis_url',
    };
  }

  const host = normalizeHost(process.env.REDIS_HOST);
  const effectiveHost = host.length > 0
    ? host
    : allowLocalFallback
      ? '127.0.0.1'
      : '';
  if (!effectiveHost) {
    return {
      config: undefined,
      reason: 'REDIS_URL/REDIS_HOST ausente; em produção não há fallback para 127.0.0.1.',
      source: 'missing',
    };
  }

  const port = normalizePort(process.env.REDIS_PORT);

  return {
    config: {
      host: effectiveHost,
      port,
      password: String(process.env.REDIS_PASSWORD ?? '').trim() || undefined,
      username: String(process.env.REDIS_USERNAME ?? '').trim() || undefined,
      maxRetriesPerRequest: null,
    },
    reason: host.length > 0
      ? 'REDIS_HOST configurado'
      : 'Fallback de desenvolvimento para 127.0.0.1',
    source: 'legacy_host',
  };
}

export function getRedisConfigForPdfQueue() {
  return resolveRedisConfig();
}

