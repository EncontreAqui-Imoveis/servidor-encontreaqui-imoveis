import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRegistry, metricsMiddleware } from './metrics';

describe('metricsMiddleware', () => {
  beforeEach(() => {
    getRegistry().resetMetrics();
  });

  it('records a bounded route label and security event without a raw identifier', async () => {
    const response = new EventEmitter() as EventEmitter & { statusCode: number };
    response.statusCode = 403;
    const request = {
      method: 'GET',
      baseUrl: '',
      originalUrl: '/admin/contracts/550e8400-e29b-41d4-a716-446655440000',
      path: '/contracts/550e8400-e29b-41d4-a716-446655440000',
      route: { path: '/contracts/:id' },
    };
    const next = vi.fn();

    metricsMiddleware(request as any, response as any, next);
    response.emit('finish');

    const output = await getRegistry().metrics();
    expect(next).toHaveBeenCalledOnce();
    expect(output).toContain('route="/admin/contracts/:id"');
    expect(output).toContain('security_events_total');
    expect(output).toContain('event="authorization_denied"');
    expect(output).not.toContain('550e8400-e29b-41d4-a716-446655440000');
  });
});
