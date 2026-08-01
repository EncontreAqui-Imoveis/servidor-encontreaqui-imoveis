import { describe, expect, it } from 'vitest';

import { buildSecurityAuditEvent } from './securityAuditService';

function request(input: Partial<Record<string, unknown>> = {}) {
  return {
    method: 'GET',
    path: '/contracts/00000000-0000-0000-0000-000000000001',
    originalUrl: '/contracts/00000000-0000-0000-0000-000000000001',
    baseUrl: '',
    route: undefined,
    ...input,
  } as any;
}

describe('security audit events', () => {
  it('redacts resource identifiers and maps an authorization denial', () => {
    const event = buildSecurityAuditEvent(
      request({ userRole: 'client', requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' }),
      { statusCode: 403 },
    );

    expect(event).toMatchObject({
      eventType: 'AUTHORIZATION_DENIED',
      severity: 'WARNING',
      actorRole: 'client',
      route: '/contracts/:id',
      statusCode: 403,
    });
    expect(event?.route).not.toContain('00000000');
  });

  it('records a successful document download without entity data', () => {
    const event = buildSecurityAuditEvent(
      request({
        method: 'GET',
        route: { path: '/contracts/:id/documents/:documentId/download' },
        baseUrl: '',
        originalUrl: '/contracts/9/documents/7/download',
        userRole: 'broker',
      }),
      { statusCode: 200 },
    );

    expect(event).toMatchObject({
      eventType: 'DOCUMENT_DOWNLOADED',
      actorRole: 'broker',
      route: '/contracts/:id/documents/:documentId/download',
    });
  });

  it('maps failed login without keeping the submitted email', () => {
    const event = buildSecurityAuditEvent(
      request({
        method: 'POST',
        route: { path: '/login' },
        baseUrl: '/auth',
        originalUrl: '/auth/login?email=nao-registre@example.test',
      }),
      { statusCode: 401 },
    );

    expect(event).toMatchObject({ eventType: 'AUTH_LOGIN_DENIED', route: '/auth/login' });
    expect(JSON.stringify(event)).not.toContain('example.test');
  });
});
