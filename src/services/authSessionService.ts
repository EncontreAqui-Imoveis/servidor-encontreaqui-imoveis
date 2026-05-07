import jwt from 'jsonwebtoken';
import { requireEnv } from '../config/env';

const jwtSecret = requireEnv('JWT_SECRET');

export type ProfileType = 'client' | 'broker' | 'auxiliary_administrative';

function normalizeBrokerStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeDocumentStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function resolveBrokerDisplayStatus(
  brokerStatus: unknown,
  brokerDocumentsStatus: unknown,
): string | null {
  const normalizedBrokerStatus = normalizeBrokerStatus(brokerStatus);
  if (!normalizedBrokerStatus) {
    return null;
  }

  if (normalizedBrokerStatus === 'pending_verification') {
    const normalizedDocsStatus = normalizeDocumentStatus(brokerDocumentsStatus);
    if (normalizedDocsStatus.length === 0) {
      return 'pending_documents';
    }
  }

  return String(brokerStatus ?? '').trim();
}

export function requiresBrokerDocuments(
  brokerStatus: unknown,
  brokerDocumentsStatus: unknown,
): boolean {
  const normalizedBrokerStatus = normalizeBrokerStatus(brokerStatus);
  if (!normalizedBrokerStatus) {
    return false;
  }

  if (normalizedBrokerStatus !== 'approved' && normalizedBrokerStatus !== 'pending_verification') {
    return false;
  }

  const normalizedDocsStatus = normalizeDocumentStatus(brokerDocumentsStatus);
  return normalizedDocsStatus.length === 0 || normalizedDocsStatus === 'rejected';
}

function buildBrokerPayload(row: any) {
  const hasBrokerData =
    row?.broker_id != null ||
    row?.broker_status != null ||
    row?.creci != null;

  if (!hasBrokerData) {
    return null;
  }

  return {
    id: Number(row.broker_id ?? row.id),
    status: resolveBrokerDisplayStatus(row.broker_status, row.broker_documents_status),
    creci: row.creci != null ? String(row.creci) : null,
  };
}

export function buildUserPayload(row: any, profileType: ProfileType) {
  const broker = buildBrokerPayload(row);
  const emailVerifiedAt = row.email_verified_at ?? row.emailVerifiedAt ?? null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    email_verified: emailVerifiedAt != null,
    email_verified_at: emailVerifiedAt,
    phone: row.phone ?? null,
    street: row.street ?? null,
    number: row.number ?? null,
    bairro: row.bairro ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    cep: row.cep ?? null,
    complement: row.complement ?? null,
    role: profileType,
    broker_status: row.broker_status ?? null,
    broker,
  };
}

export function hasCompleteProfile(row: any) {
  if (row.role === 'broker') {
    return !!(row.phone && String(row.phone).trim().length >= 8);
  }

  const phone = String(row.phone ?? '').trim();
  if (phone.length < 8) {
    return false;
  }

  return (
    String(row.street ?? '').trim().length > 0 &&
    String(row.number ?? '').trim().length > 0 &&
    String(row.bairro ?? '').trim().length > 0 &&
    String(row.city ?? '').trim().length > 0 &&
    String(row.state ?? '').trim().length > 0
  );
}

function normalizeTokenVersion(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  return Math.trunc(parsed);
}

export function signUserToken(id: number, role: ProfileType, tokenVersion: unknown) {
  return jwt.sign(
    { id, role, token_version: normalizeTokenVersion(tokenVersion) },
    jwtSecret,
    { expiresIn: '7d' },
  );
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout while waiting for ${label}`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
