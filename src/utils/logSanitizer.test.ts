import { describe, expect, it } from 'vitest';

import { redactString, redactValue } from './logSanitizer';

describe('logSanitizer', () => {
  it('mascara bearer, jwt e email em strings', () => {
    const raw =
      'Authorization: Bearer abc.def.ghi token=abc123 email=usuario@dominio.com';
    const redacted = redactString(raw);
    expect(redacted).toContain('Bearer ***');
    expect(redacted).toContain('token=***');
    expect(redacted).toContain('***@***');
  });

  it('mascara chaves sensíveis em objetos', () => {
    const redacted = redactValue({
      authorization: 'Bearer token',
      nested: { password: '123456', city: 'Rio Verde' },
    }) as Record<string, unknown>;

    expect(redacted.authorization).toBe('***');
    expect((redacted.nested as Record<string, unknown>).password).toBe('***');
    expect((redacted.nested as Record<string, unknown>).city).toBe('Rio Verde');
  });
});

