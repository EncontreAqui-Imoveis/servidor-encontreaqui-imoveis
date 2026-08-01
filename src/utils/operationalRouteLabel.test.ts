import { describe, expect, it } from 'vitest';

import { resolveOperationalRouteLabel } from './operationalRouteLabel';

describe('resolveOperationalRouteLabel', () => {
  it('uses the Express route template when available', () => {
    expect(resolveOperationalRouteLabel({
      baseUrl: '/admin',
      originalUrl: '/admin/contracts/42',
      path: '/contracts/42',
      route: { path: '/contracts/:id' },
    } as any)).toBe('/admin/contracts/:id');
  });

  it('removes numeric, UUID and long opaque path values', () => {
    expect(resolveOperationalRouteLabel({
      baseUrl: '',
      originalUrl: '/contracts/42/documents/550e8400-e29b-41d4-a716-446655440000',
      path: '/contracts/42/documents/550e8400-e29b-41d4-a716-446655440000',
      route: undefined,
    } as any)).toBe('/contracts/:id/documents/:id');

    expect(resolveOperationalRouteLabel({
      baseUrl: '',
      originalUrl: '/downloads/very-long-opaque-token-123456',
      path: '/downloads/very-long-opaque-token-123456',
      route: undefined,
    } as any)).toBe('/downloads/:id');
  });

  it('preserves a mounted route prefix without copying the resource identifier', () => {
    expect(resolveOperationalRouteLabel({
      baseUrl: '',
      originalUrl: '/admin/contracts/550e8400-e29b-41d4-a716-446655440000',
      path: '/contracts/550e8400-e29b-41d4-a716-446655440000',
      route: { path: '/contracts/:id' },
    } as any)).toBe('/admin/contracts/:id');
  });
});
