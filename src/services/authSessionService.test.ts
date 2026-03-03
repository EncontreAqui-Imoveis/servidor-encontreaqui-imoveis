import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-auth-session-secret';
});

describe('authSessionService', () => {
  it('builds user payload with broker metadata when broker data exists', async () => {
    const { buildUserPayload } = await import('./authSessionService');

    const payload = buildUserPayload(
      {
        id: 10,
        name: 'Broker Test',
        email: 'broker@test.com',
        broker_id: 22,
        broker_status: 'approved',
        creci: '1234-A',
      },
      'broker',
    );

    expect(payload.role).toBe('broker');
    expect(payload.broker).toEqual({
      id: 22,
      status: 'approved',
      creci: '1234-A',
    });
  });

  it('detects incomplete profiles and normalizes token version in signed token', async () => {
    const { hasCompleteProfile, signUserToken } = await import('./authSessionService');

    expect(
      hasCompleteProfile({
        phone: '64999999999',
        street: 'Rua 1',
        number: '10',
        bairro: 'Centro',
        city: 'Rio Verde',
        state: 'GO',
        cep: '75900000',
      }),
    ).toBe(true);

    expect(
      hasCompleteProfile({
        phone: '64999999999',
        street: 'Rua 1',
        number: '',
        bairro: 'Centro',
        city: 'Rio Verde',
        state: 'GO',
        cep: '75900000',
      }),
    ).toBe(false);

    const token = signUserToken(15, 'client', 0);
    const decoded = jwt.decode(token) as Record<string, unknown>;

    expect(decoded.id).toBe(15);
    expect(decoded.role).toBe('client');
    expect(decoded.token_version).toBe(1);
  });

  it('times out pending promises and resolves fast promises', async () => {
    const { withTimeout } = await import('./authSessionService');

    await expect(withTimeout(Promise.resolve('ok'), 10, 'fast op')).resolves.toBe('ok');

    await expect(
      withTimeout(new Promise(() => undefined), 5, 'slow op'),
    ).rejects.toThrow('Timeout while waiting for slow op');
  });
});
