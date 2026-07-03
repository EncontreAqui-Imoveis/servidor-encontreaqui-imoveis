import rateLimit, { type Store, type ClientRateLimitInfo } from 'express-rate-limit';
import type { Request } from 'express';
import Redis, { type RedisOptions } from 'ioredis';
import { getRequestId } from '../middlewares/requestContext';
import { resolveRedisConfig } from './redis';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 300;
const DEFAULT_AUTH_LIMIT = 20;
const DEFAULT_AUTH_LIGHT_LIMIT = 120;
const DEFAULT_ADMIN_AUTH_LIMIT = 10;

function resolveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class RedisRateLimitStore implements Store {
  localKeys = false;
  prefix: string;
  private readonly redis: Redis;
  private windowMs = DEFAULT_WINDOW_MS;

  constructor(prefix: string) {
    const redisConnection = resolveRedisConfig();
    if (!redisConnection.config) {
      throw new Error('Redis indisponível para rate limiting.');
    }

    this.prefix = prefix;
    this.redis = new Redis(redisConnection.config as RedisOptions);
  }

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date | undefined }> {
    const storeKey = this.prefixedKey(key);
    const totalHits = await this.redis.incr(storeKey);
    if (totalHits === 1) {
      await this.redis.pexpire(storeKey, this.windowMs);
    }
    const ttl = await this.redis.pttl(storeKey);

    return {
      totalHits,
      resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined,
    };
  }

  async decrement(key: string): Promise<void> {
    const storeKey = this.prefixedKey(key);
    const current = await this.redis.get(storeKey);
    const hits = Number(current ?? 0);
    if (!Number.isFinite(hits) || hits <= 1) {
      await this.redis.del(storeKey);
      return;
    }
    await this.redis.decr(storeKey);
  }

  async resetKey(key: string): Promise<void> {
    await this.redis.del(this.prefixedKey(key));
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const storeKey = this.prefixedKey(key);
    const current = await this.redis.get(storeKey);
    const hits = Number(current ?? 0);
    if (!Number.isFinite(hits) || hits <= 0) {
      return undefined;
    }
    const ttl = await this.redis.pttl(storeKey);
    return {
      totalHits: hits,
      resetTime: ttl > 0 ? new Date(Date.now() + ttl) : undefined,
    };
  }

  async shutdown(): Promise<void> {
    await this.redis.quit();
  }

  private prefixedKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

function createSharedStore(prefix: string): Store | undefined {
  try {
    return new RedisRateLimitStore(prefix);
  } catch {
    return undefined;
  }
}

function createLimiter(options: {
  windowMs: number;
  limit: number;
  message: string;
  prefix: string;
  skip?: (req: Request) => boolean;
}) {
  const store = createSharedStore(options.prefix);
  const rateLimitOptions: Parameters<typeof rateLimit>[0] = {
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: options.message },
    skip: options.skip,
    passOnStoreError: true,
    handler: (req, res) => {
      return res.status(429).json({
        error: options.message,
        requestId: getRequestId(req),
      });
    },
  };

  if (store) {
    rateLimitOptions.store = store;
  }

  return rateLimit(rateLimitOptions);
}

export function createGlobalRateLimiter() {
  return createLimiter({
    windowMs: resolveNumber(process.env.RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    limit: resolveNumber(process.env.RATE_LIMIT_MAX_REQUESTS, DEFAULT_LIMIT),
    message: 'Muitas requisições. Tente novamente em instantes.',
    prefix: 'rl:api:',
    skip: (req) => req.path === '/health' || req.method === 'OPTIONS',
  });
}

export function createAuthSensitiveLimiter() {
  return createLimiter({
    windowMs: resolveNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    limit: resolveNumber(process.env.AUTH_RATE_LIMIT_MAX, DEFAULT_AUTH_LIMIT),
    message: 'Muitas tentativas em rotas de autenticacao. Tente novamente em instantes.',
    prefix: 'rl:auth:sensitive:',
  });
}

export function createAuthLightLimiter() {
  return createLimiter({
    windowMs: resolveNumber(process.env.AUTH_LIGHT_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    limit: resolveNumber(process.env.AUTH_LIGHT_RATE_LIMIT_MAX, DEFAULT_AUTH_LIGHT_LIMIT),
    message: 'Muitas tentativas de consulta de autenticacao. Tente novamente em instantes.',
    prefix: 'rl:auth:light:',
  });
}

export function createAdminAuthLimiter() {
  return createLimiter({
    windowMs: resolveNumber(process.env.ADMIN_AUTH_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS),
    limit: resolveNumber(process.env.ADMIN_AUTH_RATE_LIMIT_MAX, DEFAULT_ADMIN_AUTH_LIMIT),
    message: 'Muitas tentativas de login administrativo. Tente novamente em instantes.',
    prefix: 'rl:admin:auth:',
  });
}
