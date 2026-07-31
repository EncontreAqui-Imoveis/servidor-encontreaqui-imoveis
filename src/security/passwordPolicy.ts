import bcrypt from 'bcryptjs';

export type PasswordAccountKind = 'user' | 'admin';

export const USER_PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MIN_LENGTH = 14;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordValidationError = {
  code: 'PASSWORD_REQUIRED' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_TOO_LONG';
  message: string;
  minLength: number;
  maxLength: number;
};

function minimumLengthFor(kind: PasswordAccountKind): number {
  return kind === 'admin' ? ADMIN_PASSWORD_MIN_LENGTH : USER_PASSWORD_MIN_LENGTH;
}

export function validateNewPassword(
  value: unknown,
  kind: PasswordAccountKind = 'user',
): PasswordValidationError | null {
  const password = typeof value === 'string' ? value : '';
  const minLength = minimumLengthFor(kind);

  if (password.trim().length === 0) {
    return {
      code: 'PASSWORD_REQUIRED',
      message: 'Informe uma senha.',
      minLength,
      maxLength: PASSWORD_MAX_LENGTH,
    };
  }

  if (password.length < minLength) {
    return {
      code: 'PASSWORD_TOO_SHORT',
      message: `A senha deve ter pelo menos ${minLength} caracteres.`,
      minLength,
      maxLength: PASSWORD_MAX_LENGTH,
    };
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return {
      code: 'PASSWORD_TOO_LONG',
      message: `A senha deve ter no maximo ${PASSWORD_MAX_LENGTH} caracteres.`,
      minLength,
      maxLength: PASSWORD_MAX_LENGTH,
    };
  }

  return null;
}

function resolveBcryptRounds(): number {
  const configured = Number.parseInt(String(process.env.BCRYPT_ROUNDS ?? ''), 10);
  if (Number.isFinite(configured) && configured >= 12 && configured <= 14) {
    return configured;
  }

  // Unit tests exercise behavior, not the production work factor.
  return process.env.NODE_ENV === 'test' ? 4 : 12;
}

export function getPasswordHashRounds(): number {
  return resolveBcryptRounds();
}

export async function hashNewPassword(password: string): Promise<string> {
  return bcrypt.hash(password, resolveBcryptRounds());
}
