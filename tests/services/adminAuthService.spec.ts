import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: vi.fn(),
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock('../../src/services/adminControllerSupport', () => ({
  signAdminToken: vi.fn(() => 'admin-token'),
  signAdminReauthToken: vi.fn(() => 'reauth-token'),
}));

import bcrypt from 'bcryptjs';
import { ApplicationError } from '../../src/errors/ApplicationError';
import { adminDb } from '../../src/services/adminPersistenceService';
import { login, logout, reauth } from '../../src/services/adminAuthService';

describe('adminAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs in admin and returns token', async () => {
    vi.mocked(adminDb.query).mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'Admin',
          email: 'admin@test.com',
          password_hash: 'hash',
          token_version: 2,
        },
      ],
    ] as any);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);

    await expect(login({ email: 'admin@test.com', password: 'secret' })).resolves.toEqual({
      admin: expect.objectContaining({ id: 1, email: 'admin@test.com' }),
      token: 'admin-token',
    });
  });

  it('rejects invalid admin credentials', async () => {
    vi.mocked(adminDb.query).mockResolvedValueOnce([
      [
        {
          id: 1,
          name: 'Admin',
          email: 'admin@test.com',
          password_hash: 'hash',
          token_version: 2,
        },
      ],
    ] as any);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as any);

    await expect(login({ email: 'admin@test.com', password: 'wrong' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('logs out admin by bumping token version', async () => {
    vi.mocked(adminDb.query).mockResolvedValueOnce([{ affectedRows: 1 }] as any);

    await expect(logout({ userId: 1 } as any)).resolves.toEqual({
      message: 'Logout realizado com sucesso.',
    });
  });

  it('returns not found when logout targets missing admin', async () => {
    vi.mocked(adminDb.query).mockResolvedValueOnce([{ affectedRows: 0 }] as any);

    await expect(logout({ userId: 999 } as any)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('issues reauth token for valid password', async () => {
    vi.mocked(adminDb.query).mockResolvedValueOnce([
      [{ id: 1, password_hash: 'hash', token_version: 2 }],
    ] as any);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);

    await expect(reauth({ userId: 1 } as any, 'secret')).resolves.toEqual({
      reauthToken: 'reauth-token',
      expiresInSeconds: 600,
    });
  });

  it('rejects invalid reauth password', async () => {
    vi.mocked(adminDb.query).mockResolvedValueOnce([
      [{ id: 1, password_hash: 'hash', token_version: 2 }],
    ] as any);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as any);

    await expect(reauth({ userId: 1 } as any, 'wrong')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('throws application errors for invalid input', async () => {
    await expect(login({ email: '', password: '' })).rejects.toBeInstanceOf(ApplicationError);
    await expect(logout({ userId: 0 } as any)).rejects.toBeInstanceOf(ApplicationError);
    await expect(reauth({ userId: 1 } as any, '')).rejects.toBeInstanceOf(ApplicationError);
  });
});
