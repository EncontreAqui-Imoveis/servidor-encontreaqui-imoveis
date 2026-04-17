import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';
import {
  sanitizeAddressInput as sanitizeAddress,
  sanitizePartialAddressInput as sanitizePartialAddress,
} from '../utils/address';
import {
  hasValidCreci as hasValidBrokerCreci,
  normalizeCreci as normalizeBrokerCreci,
} from '../utils/creci';
import { normalizePropertyType as normalizePropertyTypeValue } from '../utils/propertyTypes';

const jwtSecret = requireEnv('JWT_SECRET');
const ADMIN_REAUTH_PURPOSE = 'destructive_action';

function normalizeTokenVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.trunc(parsed);
}

export function signAdminToken(id: number, tokenVersion: unknown) {
  return jwt.sign(
    { id, role: 'admin', token_version: normalizeTokenVersion(tokenVersion) },
    jwtSecret,
    { expiresIn: '1d' },
  );
}

export type AdminReauthTokenPayload = {
  id: number;
  role: 'admin';
  token_version: number;
  purpose: typeof ADMIN_REAUTH_PURPOSE;
};

export function signAdminReauthToken(id: number, tokenVersion: unknown) {
  return jwt.sign(
    {
      id,
      role: 'admin',
      token_version: normalizeTokenVersion(tokenVersion),
      purpose: ADMIN_REAUTH_PURPOSE,
    },
    jwtSecret,
    { expiresIn: '10m' },
  );
}

export function verifyAdminReauthToken(token: string): AdminReauthTokenPayload {
  return jwt.verify(token, jwtSecret) as AdminReauthTokenPayload;
}

export function sanitizeAddressInput(input: Parameters<typeof sanitizeAddress>[0]) {
  return sanitizeAddress(input);
}

export function sanitizePartialAddressInput(
  input: Parameters<typeof sanitizePartialAddress>[0],
) {
  return sanitizePartialAddress(input);
}

export function hasValidCreci(value: unknown) {
  return hasValidBrokerCreci(value);
}

export function normalizeCreci(value: unknown) {
  return normalizeBrokerCreci(value);
}

export function normalizePropertyType(value: unknown) {
  return normalizePropertyTypeValue(value);
}
