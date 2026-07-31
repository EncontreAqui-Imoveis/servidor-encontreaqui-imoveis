import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';

import connection from '../database/connection';

export const PRIVACY_REQUEST_TYPES = [
  'ACCESS',
  'CORRECTION',
  'DELETION',
  'OPPOSITION',
  'PORTABILITY',
] as const;

export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];
export type PrivacyRequestStatus = 'PENDING' | 'IN_REVIEW' | 'COMPLETED' | 'DENIED';

type PrivacyRequestRow = RowDataPacket & {
  id: string;
  request_type: PrivacyRequestType;
  status: PrivacyRequestStatus;
  resolution_code: string | null;
  requested_at: Date;
  resolved_at: Date | null;
};

export class PrivacyRequestValidationError extends Error {
  constructor() {
    super('Tipo de solicitacao de privacidade invalido.');
    this.name = 'PrivacyRequestValidationError';
  }
}

function normalizeRequestType(value: unknown): PrivacyRequestType {
  const normalized = String(value ?? '').trim().toUpperCase();
  if ((PRIVACY_REQUEST_TYPES as readonly string[]).includes(normalized)) {
    return normalized as PrivacyRequestType;
  }
  throw new PrivacyRequestValidationError();
}

function toPayload(row: PrivacyRequestRow) {
  return {
    id: row.id,
    type: row.request_type,
    status: row.status,
    resolutionCode: row.resolution_code,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
  };
}

export async function createPrivacyRequest(input: {
  requesterUserId: number;
  type: unknown;
}) {
  const requesterUserId = Number(input.requesterUserId);
  if (!Number.isInteger(requesterUserId) || requesterUserId <= 0) {
    throw new PrivacyRequestValidationError();
  }
  const type = normalizeRequestType(input.type);
  const [existingRows] = await connection.query<PrivacyRequestRow[]>(
    `
      SELECT id, request_type, status, resolution_code, requested_at, resolved_at
      FROM privacy_requests
      WHERE requester_user_id = ?
        AND request_type = ?
        AND status IN ('PENDING', 'IN_REVIEW')
      ORDER BY requested_at DESC
      LIMIT 1
    `,
    [requesterUserId, type]
  );
  if (existingRows.length > 0) return toPayload(existingRows[0]);

  const id = crypto.randomUUID();
  await connection.query(
    `
      INSERT INTO privacy_requests (id, requester_user_id, request_type)
      VALUES (?, ?, ?)
    `,
    [id, requesterUserId, type]
  );
  return {
    id,
    type,
    status: 'PENDING' as const,
    resolutionCode: null,
    requestedAt: new Date(),
    resolvedAt: null,
  };
}

export async function listOwnPrivacyRequests(requesterUserId: number) {
  const [rows] = await connection.query<PrivacyRequestRow[]>(
    `
      SELECT id, request_type, status, resolution_code, requested_at, resolved_at
      FROM privacy_requests
      WHERE requester_user_id = ?
      ORDER BY requested_at DESC
      LIMIT 100
    `,
    [requesterUserId]
  );
  return rows.map(toPayload);
}
