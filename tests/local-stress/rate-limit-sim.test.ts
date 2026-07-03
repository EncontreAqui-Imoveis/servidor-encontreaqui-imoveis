import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/config/redis', () => ({
  resolveRedisConfig: () => ({
    config: undefined,
    reason: 'mocked missing redis',
    source: 'missing',
  }),
}));

describe('local stress: rate limit simulation', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';

    const { createAuthSensitiveLimiter } = await import('../../src/config/rateLimiters');
    const limiter = createAuthSensitiveLimiter();

    app = express();
    app.use(express.json());
    app.post('/probe', limiter, (_req, res) => {
      return res.status(200).json({ ok: true });
    });
  });

  it('blocks requests after the configured limit without using external traffic', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        request(app).post('/probe').send({}).catch((error) => ({
          status: error?.response?.status ?? 0,
        })),
      ),
    );

    const okCount = results.filter((result) => result.status === 200).length;
    const blockedCount = results.filter((result) => result.status === 429).length;

    expect(okCount).toBe(3);
    expect(blockedCount).toBeGreaterThan(0);
  });
});
