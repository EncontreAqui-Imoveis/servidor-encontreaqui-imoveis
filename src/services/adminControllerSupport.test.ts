import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-admin-support-secret';
});

describe('adminControllerSupport', () => {
  it('signs admin token with normalized token version', async () => {
    const { signAdminToken } = await import('./adminControllerSupport');

    const token = signAdminToken(8, -1);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded.id).toBe(8);
    expect(decoded.role).toBe('admin');
    expect(decoded.token_version).toBe(1);
  });

  it('delegates creci, property type and address normalization helpers', async () => {
    const {
      hasValidCreci,
      normalizeCreci,
      normalizePropertyType,
      sanitizeAddressInput,
    } = await import('./adminControllerSupport');

    expect(hasValidCreci('1234-A')).toBe(true);
    expect(normalizeCreci('1234 a')).toBe('1234A');
    expect(normalizePropertyType('propriedade comercial')).toBe('Imóvel comercial');

    const address = sanitizeAddressInput({
      street: 'Rua A',
      number: '10',
      bairro: 'Centro',
      city: 'Rio Verde',
      state: 'GO',
      cep: '75900000',
    });

    expect(address.ok).toBe(true);
    if (address.ok) {
      expect(address.value.cep).toBe('75900000');
      expect(address.value.complement).toBeNull();
    }
  });
});
