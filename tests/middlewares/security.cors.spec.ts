import { afterEach, describe, expect, it } from 'vitest';
import { buildCorsOptions } from '../../src/middlewares/security';

const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  origins: process.env.CORS_ORIGINS,
  localOrigins: process.env.CORS_LOCAL_ORIGINS,
};

afterEach(() => {
  if (originalEnv.nodeEnv == null) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.origins == null) delete process.env.CORS_ORIGINS;
  else process.env.CORS_ORIGINS = originalEnv.origins;
  if (originalEnv.localOrigins == null) delete process.env.CORS_LOCAL_ORIGINS;
  else process.env.CORS_LOCAL_ORIGINS = originalEnv.localOrigins;
});

function resolveOrigin(origin: string): Promise<boolean> {
  const options = buildCorsOptions();
  const resolver = options.origin as (origin: string, callback: (error: Error | null, allowed?: boolean) => void) => void;
  return new Promise((resolve) => resolver(origin, (_error, allowed) => resolve(Boolean(allowed))));
}

describe('buildCorsOptions', () => {
  it('permite o cabeçalho X-Admin-Reauth no preflight (ações com reautenticação)', () => {
    const opts = buildCorsOptions();
    const headers = opts.allowedHeaders ?? [];
    expect(headers.map((h) => h.toLowerCase())).toContain('x-admin-reauth');
  });

  it('accepts only exact configured origins in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://painel.exemplo.com,https://site.exemplo.com';
    process.env.CORS_LOCAL_ORIGINS = 'http://localhost:5173';

    await expect(resolveOrigin('https://painel.exemplo.com')).resolves.toBe(true);
    await expect(resolveOrigin('https://evil.vercel.app')).resolves.toBe(false);
    await expect(resolveOrigin('http://localhost:5173')).resolves.toBe(false);
  });

  it('fails closed for browser origins when production has no configured origin', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_LOCAL_ORIGINS;

    await expect(resolveOrigin('https://site.exemplo.com')).resolves.toBe(false);
  });
});
