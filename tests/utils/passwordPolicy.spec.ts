import { afterEach, describe, expect, it } from 'vitest';

import {
  ADMIN_PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  USER_PASSWORD_MIN_LENGTH,
  getPasswordHashRounds,
  validateNewPassword,
} from '../../src/security/passwordPolicy';

const originalRounds = process.env.BCRYPT_ROUNDS;

afterEach(() => {
  if (originalRounds === undefined) {
    delete process.env.BCRYPT_ROUNDS;
  } else {
    process.env.BCRYPT_ROUNDS = originalRounds;
  }
});

describe('passwordPolicy', () => {
  it('requires 12 through 128 characters for user accounts', () => {
    expect(validateNewPassword('a'.repeat(USER_PASSWORD_MIN_LENGTH - 1))?.code).toBe(
      'PASSWORD_TOO_SHORT',
    );
    expect(validateNewPassword('a'.repeat(USER_PASSWORD_MIN_LENGTH))).toBeNull();
    expect(validateNewPassword('a'.repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(validateNewPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))?.code).toBe(
      'PASSWORD_TOO_LONG',
    );
  });

  it('requires 14 through 128 characters for administrative accounts', () => {
    expect(validateNewPassword('a'.repeat(ADMIN_PASSWORD_MIN_LENGTH - 1), 'admin')?.code).toBe(
      'PASSWORD_TOO_SHORT',
    );
    expect(validateNewPassword('a'.repeat(ADMIN_PASSWORD_MIN_LENGTH), 'admin')).toBeNull();
  });

  it('accepts only a production-safe configured bcrypt cost', () => {
    process.env.BCRYPT_ROUNDS = '13';
    expect(getPasswordHashRounds()).toBe(13);

    process.env.BCRYPT_ROUNDS = '8';
    expect(getPasswordHashRounds()).toBe(4);
  });
});
