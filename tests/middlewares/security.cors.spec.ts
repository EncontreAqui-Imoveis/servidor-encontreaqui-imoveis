import { describe, expect, it } from 'vitest';
import { buildCorsOptions } from '../../src/middlewares/security';

describe('buildCorsOptions', () => {
  it('permite o cabeçalho X-Admin-Reauth no preflight (ações com reautenticação)', () => {
    const opts = buildCorsOptions();
    const headers = opts.allowedHeaders ?? [];
    expect(headers.map((h) => h.toLowerCase())).toContain('x-admin-reauth');
  });
});
