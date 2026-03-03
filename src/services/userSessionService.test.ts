import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-user-session-secret';
});

describe('userSessionService', () => {
  it('signs user tokens with explicit expiry and normalized token version', async () => {
    const { signUserToken } = await import('./userSessionService');

    const token = signUserToken(42, 'broker', null, '1d');
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded.id).toBe(42);
    expect(decoded.role).toBe('broker');
    expect(decoded.token_version).toBe(1);
  });

  it('sanitizes full and partial address payloads through wrappers', async () => {
    const { sanitizeAddressInput, sanitizePartialAddressInput } = await import('./userSessionService');

    const fullAddress = sanitizeAddressInput({
      street: 'Rua 1',
      number: '100',
      bairro: 'Centro',
      city: 'Rio Verde',
      state: 'GO',
      cep: '75900000',
    });
    expect(fullAddress.ok).toBe(true);

    const partialAddress = sanitizePartialAddressInput({
      street: 'Rua 1',
      city: 'Rio Verde',
    });
    expect(partialAddress.ok).toBe(true);
    if (partialAddress.ok) {
      expect(partialAddress.value.street).toBe('Rua 1');
      expect(partialAddress.value.city).toBe('Rio Verde');
    }
  });
});
