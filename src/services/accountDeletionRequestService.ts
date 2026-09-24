import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { RowDataPacket } from 'mysql2';

import admin from '../config/firebaseAdmin';
import {
  InternalError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedError,
  isApplicationError,
} from '../errors/ApplicationError';
import { authDb } from './authPersistenceService';
import { withTimeout } from './authSessionService';

const ACCOUNT_DELETION_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REAUTH_AGE_MS = 5 * 60 * 1000;
const FIREBASE_SESSION_REVOCATION_FAILED = 'FIREBASE_SESSION_REVOCATION_FAILED';

type AccountDeletionUserRow = RowDataPacket & {
  id: number;
  email: string;
  password_hash: string | null;
  firebase_uid: string | null;
  deletion_requested_at: Date | string | null;
};

type DeletionPrivacyRequestRow = RowDataPacket & {
  id: string;
  status: 'PENDING' | 'IN_REVIEW' | 'COMPLETED' | 'DENIED';
  scheduled_for: Date | string | null;
  access_revoked_at: Date | string | null;
};

export type StartAccountDeletionInput = {
  userId: number;
  currentPassword?: unknown;
  firebaseIdToken?: unknown;
  now?: Date;
};

export type StartAccountDeletionResult = {
  requestId: string;
  status: 'IN_REVIEW';
  scheduledFor: string;
};

function normalizeOptionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function passwordProof(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseDate(value: Date | string | null): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function assertRecentFirebaseAuthTime(authTime: unknown, now: Date): void {
  const authTimeSeconds = Number(authTime);
  const authTimeMs = authTimeSeconds * 1000;
  if (
    !Number.isFinite(authTimeSeconds)
    || authTimeSeconds <= 0
    || authTimeMs > now.getTime() + 60_000
    || now.getTime() - authTimeMs > MAX_REAUTH_AGE_MS
  ) {
    throw new UnauthorizedError('Confirme sua identidade novamente para excluir a conta.', {
      code: 'ACCOUNT_DELETION_REAUTH_REQUIRED',
      retryable: false,
    });
  }
}

async function validateDeletionReauthentication(
  user: AccountDeletionUserRow,
  input: StartAccountDeletionInput,
  now: Date,
): Promise<void> {
  const currentPassword = passwordProof(input.currentPassword);
  const firebaseIdToken = normalizeOptionalString(input.firebaseIdToken);

  if ((currentPassword && firebaseIdToken) || (!currentPassword && !firebaseIdToken)) {
    throw new InvalidInputError('Informe uma única prova de reautenticação.', {
      code: 'ACCOUNT_DELETION_REAUTH_REQUIRED',
    });
  }

  if (currentPassword) {
    if (!user.password_hash || !(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new UnauthorizedError('Não foi possível confirmar sua identidade.', {
        code: 'ACCOUNT_DELETION_REAUTH_INVALID',
        retryable: false,
      });
    }
    return;
  }

  let decoded: { uid?: string; auth_time?: unknown };
  try {
    decoded = await withTimeout(
      admin.auth().verifyIdToken(firebaseIdToken),
      8000,
      'account deletion Firebase reauthentication',
    ) as { uid?: string; auth_time?: unknown };
  } catch {
    throw new UnauthorizedError('Não foi possível confirmar sua identidade.', {
      code: 'ACCOUNT_DELETION_REAUTH_INVALID',
      retryable: false,
    });
  }

  if (!user.firebase_uid || decoded.uid !== user.firebase_uid) {
    throw new UnauthorizedError('A identidade informada não corresponde a esta conta.', {
      code: 'ACCOUNT_DELETION_IDENTITY_MISMATCH',
      retryable: false,
    });
  }

  assertRecentFirebaseAuthTime(decoded.auth_time, now);
}

async function removeTemporaryAccountCredentials(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  user: AccountDeletionUserRow,
): Promise<void> {
  await db.query('DELETE FROM user_device_tokens WHERE user_id = ?', [user.id]);
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [user.id]);
  await db.query('DELETE FROM email_code_challenges WHERE user_id = ? OR email = ?', [user.id, user.email]);
  await db.query(
    `
      UPDATE registration_phone_otps otp
      INNER JOIN registration_drafts draft ON draft.id = otp.draft_id
      SET otp.invalidated = 1
      WHERE draft.user_id = ?
        AND otp.consumed_at IS NULL
    `,
    [user.id],
  );
}

async function revokeFirebaseSessionsAfterDeletion(
  firebaseUid: string | null,
  requestId: string,
): Promise<void> {
  const normalizedFirebaseUid = normalizeOptionalString(firebaseUid);
  if (!normalizedFirebaseUid) return;

  try {
    await admin.auth().revokeRefreshTokens(normalizedFirebaseUid);
  } catch {
    try {
      await authDb.query(
        'UPDATE privacy_requests SET last_error_code = ? WHERE id = ?',
        [FIREBASE_SESSION_REVOCATION_FAILED, requestId],
      );
    } catch {
      console.warn('Falha ao registrar revogacao externa de sessao pendente.', {
        code: 'ACCOUNT_DELETION_FIREBASE_REVOCATION_RECORD_FAILED',
      });
      return;
    }

    console.warn('Falha ao revogar sessao externa apos exclusao de conta.', {
      code: FIREBASE_SESSION_REVOCATION_FAILED,
    });
    return;
  }

  try {
    await authDb.query(
      'UPDATE privacy_requests SET last_error_code = NULL WHERE id = ? AND last_error_code = ?',
      [requestId, FIREBASE_SESSION_REVOCATION_FAILED],
    );
  } catch {
    console.warn('Falha ao atualizar status de revogacao externa de sessao.', {
      code: 'ACCOUNT_DELETION_FIREBASE_REVOCATION_STATUS_RECORD_FAILED',
    });
  }
}

export async function startAccountDeletion(
  input: StartAccountDeletionInput,
): Promise<StartAccountDeletionResult> {
  const userId = Number(input.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new UnauthorizedError('Usuário não autenticado.');
  }

  const now = input.now ?? new Date();
  const defaultScheduledFor = new Date(now.getTime() + ACCOUNT_DELETION_DELAY_MS);
  const db = await authDb.getConnection();
  let committedResult: StartAccountDeletionResult | null = null;
  let committedFirebaseUid: string | null = null;

  try {
    await db.beginTransaction();
    const [userRows] = await db.query<AccountDeletionUserRow[]>(
      `
        SELECT id, email, password_hash, firebase_uid, deletion_requested_at
        FROM users
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [userId],
    );
    const user = userRows[0];
    if (!user) {
      throw new NotFoundError('Usuário não encontrado.');
    }

    await validateDeletionReauthentication(user, input, now);

    const [requestRows] = await db.query<DeletionPrivacyRequestRow[]>(
      `
        SELECT id, status, scheduled_for, access_revoked_at
        FROM privacy_requests
        WHERE requester_user_id = ?
          AND request_type = 'DELETION'
          AND status IN ('PENDING', 'IN_REVIEW')
        ORDER BY requested_at DESC
        LIMIT 1
        FOR UPDATE
      `,
      [userId],
    );
    const existingRequest = requestRows[0] ?? null;
    const scheduledFor = parseDate(existingRequest?.scheduled_for ?? null) ?? defaultScheduledFor;

    if (user.deletion_requested_at != null) {
      if (!existingRequest) {
        const requestId = crypto.randomUUID();
        await db.query(
          `
            INSERT INTO privacy_requests (
              id, requester_user_id, request_type, status, scheduled_for, access_revoked_at
            ) VALUES (?, ?, 'DELETION', 'IN_REVIEW', ?, ?)
          `,
          [requestId, userId, scheduledFor, now],
        );
        await db.commit();
        committedResult = { requestId, status: 'IN_REVIEW', scheduledFor: scheduledFor.toISOString() };
        committedFirebaseUid = user.firebase_uid;
      } else {
        await db.commit();
        committedResult = {
          requestId: existingRequest.id,
          status: 'IN_REVIEW',
          scheduledFor: scheduledFor.toISOString(),
        };
        committedFirebaseUid = user.firebase_uid;
      }
    } else {
      const requestId = existingRequest?.id ?? crypto.randomUUID();
      if (existingRequest) {
        await db.query(
          `
            UPDATE privacy_requests
            SET status = 'IN_REVIEW',
                scheduled_for = COALESCE(scheduled_for, ?),
                access_revoked_at = COALESCE(access_revoked_at, ?)
            WHERE id = ?
          `,
          [scheduledFor, now, requestId],
        );
      } else {
        await db.query(
          `
            INSERT INTO privacy_requests (
              id, requester_user_id, request_type, status, scheduled_for, access_revoked_at
            ) VALUES (?, ?, 'DELETION', 'IN_REVIEW', ?, ?)
          `,
          [requestId, userId, scheduledFor, now],
        );
      }

      await db.query(
        `
          UPDATE users
          SET deletion_requested_at = ?,
              token_version = COALESCE(token_version, 1) + 1
          WHERE id = ?
        `,
        [now, userId],
      );
      await removeTemporaryAccountCredentials(db, user);
      await db.commit();
      committedResult = { requestId, status: 'IN_REVIEW', scheduledFor: scheduledFor.toISOString() };
      committedFirebaseUid = user.firebase_uid;
    }
  } catch (error) {
    await db.rollback();
    if (isApplicationError(error)) {
      throw error;
    }
    throw new InternalError('Não foi possível iniciar a exclusão da conta.');
  } finally {
    db.release();
  }

  if (!committedResult) {
    throw new InternalError('Não foi possível iniciar a exclusão da conta.');
  }

  await revokeFirebaseSessionsAfterDeletion(committedFirebaseUid, committedResult.requestId);
  return committedResult;
}
