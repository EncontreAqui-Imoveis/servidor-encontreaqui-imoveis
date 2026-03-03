import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';
import { sanitizeAddressInput as sanitizeAddress } from '../utils/address';
import {
  hasValidCreci as hasValidBrokerCreci,
  normalizeCreci as normalizeBrokerCreci,
} from '../utils/creci';
import { normalizePropertyType as normalizePropertyTypeValue } from '../utils/propertyTypes';

const jwtSecret = requireEnv('JWT_SECRET');

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

export function sanitizeAddressInput(input: Parameters<typeof sanitizeAddress>[0]) {
  return sanitizeAddress(input);
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
