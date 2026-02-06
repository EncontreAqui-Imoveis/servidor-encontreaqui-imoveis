import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';

import { buildCorsOptions, enforceHttps, securityHeaders } from './security';

function createResponseMock() {
  const headers = new Map<string, string>();
  let statusCode = 200;
  let redirectCode: number | null = null;
  let redirectTarget = '';
  let jsonPayload: unknown;

  const res: Partial<Response> = {
    setHeader: (name: string, value: string | string[]) => {
      headers.set(name, Array.isArray(value) ? value.join(',') : value);
      return res as Response;
    },
    status: (code: number) => {
      statusCode = code;
      return res as Response;
    },
    json: (payload: unknown) => {
      jsonPayload = payload;
      return res as Response;
    },
    redirect: (arg1: number | string, arg2?: string | number) => {
      if (typeof arg1 === 'number' && typeof arg2 === 'string') {
        redirectCode = arg1;
        redirectTarget = arg2;
      } else if (typeof arg1 === 'string' && typeof arg2 === 'number') {
        redirectCode = arg2;
        redirectTarget = arg1;
      } else if (typeof arg1 === 'string') {
        redirectCode = 302;
        redirectTarget = arg1;
      }
      return res as Response;
    },
  };

  return {
    res: res as Response,
    headers,
    get statusCode() {
      return statusCode;
    },
    get redirectCode() {
      return redirectCode;
    },
    get redirectTarget() {
      return redirectTarget;
    },
    get jsonPayload() {
      return jsonPayload;
    },
  };
}

describe('securityHeaders', () => {
  it('adiciona cabecalhos de hardening', () => {
    const { res, headers } = createResponseMock();
    let nextCalled = false;

    securityHeaders({} as Request, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
  });
});

describe('enforceHttps', () => {
  it('redireciona para https quando habilitado e request inseguro', () => {
    process.env.ENFORCE_HTTPS = 'true';
    const state = createResponseMock();
    const { res } = state;
    let nextCalled = false;

    enforceHttps(
      {
        secure: false,
        headers: { host: 'example.com', 'x-forwarded-proto': 'http' },
        originalUrl: '/admin/properties',
      } as unknown as Request,
      res,
      () => {
        nextCalled = true;
      }
    );

    expect(nextCalled).toBe(false);
    expect(state.redirectCode).toBe(308);
    expect(state.redirectTarget).toBe('https://example.com/admin/properties');
  });

  it('permite seguir quando request ja esta em https', () => {
    process.env.ENFORCE_HTTPS = 'true';
    const { res } = createResponseMock();
    let nextCalled = false;

    enforceHttps(
      {
        secure: true,
        headers: { host: 'example.com' },
        originalUrl: '/health',
      } as unknown as Request,
      res,
      () => {
        nextCalled = true;
      }
    );

    expect(nextCalled).toBe(true);
  });
});

describe('buildCorsOptions', () => {
  it('aceita origem configurada e bloqueia origem fora da lista', () => {
    process.env.CORS_ORIGINS = 'https://painel.exemplo.com,https://app.exemplo.com';
    const options = buildCorsOptions();
    const originFn = options.origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void
    ) => void;

    let allowed: boolean | undefined;
    originFn('https://painel.exemplo.com', (_err, isAllowed) => {
      allowed = isAllowed;
    });
    expect(allowed).toBe(true);

    originFn('https://malicioso.exemplo.com', (_err, isAllowed) => {
      allowed = isAllowed;
    });
    expect(allowed).toBe(false);
  });
});
