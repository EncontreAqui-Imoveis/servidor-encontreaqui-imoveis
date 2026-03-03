import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';
import {
  sanitizeAddressInput as sanitizeAddress,
  sanitizePartialAddressInput as sanitizePartialAddress,
} from '../utils/address';

const jwtSecret = requireEnv('JWT_SECRET');

function normalizeTokenVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.trunc(parsed);
}

export function signUserToken(
  userId: number,
  role: 'client' | 'broker',
  tokenVersion: unknown,
  expiresIn: '1d' | '7d',
): string {
  return jwt.sign(
    { id: userId, role, token_version: normalizeTokenVersion(tokenVersion) },
    jwtSecret,
    { expiresIn },
  );
}

export function sanitizeAddressInput(input: Parameters<typeof sanitizeAddress>[0]) {
  return sanitizeAddress(input);
}

export function sanitizePartialAddressInput(
  input: Parameters<typeof sanitizePartialAddress>[0],
) {
  return sanitizePartialAddress(input);
}
