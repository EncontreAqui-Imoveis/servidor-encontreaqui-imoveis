import crypto from 'crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2';

import { authDb } from './authPersistenceService';

export type EmailChallengePurpose = 'verify_email' | 'password_reset';
export type EmailChallengeStatus = 'sent' | 'verified' | 'consumed' | 'expired' | 'locked';

const CODE_TTL_MINUTES = 15;
const RESET_SESSION_TTL_MINUTES = 15;
const DAILY_RESEND_LIMIT = 5;
const RESEND_COOLDOWN_STEPS_SECONDS = [60, 90, 120] as const;
const MAX_FAILED_ATTEMPTS = 5;

interface EmailCodeChallengeRow extends RowDataPacket {
  id: number;
  user_id: number | null;
  draft_id: number | null;
  draft_token_hash: string | null;
  draft_step: number | null;
  email: string;
  purpose: EmailChallengePurpose;
  code_hash: string;
  send_attempt_number: number;
  failed_attempts: number;
  max_attempts: number;
  cooldown_seconds: number;
  expires_at: Date | string;
  sent_at: Date | string;
  delivery_provider: string;
  status: EmailChallengeStatus | string;
  verified_at: Date | string | null;
  consumed_at: Date | string | null;
  session_token_hash: string | null;
  session_expires_at: Date | string | null;
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  return value instanceof Date ? value : new Date(value);
}

type Queryable = {
  query: typeof authDb.query;
};

function floorPositiveSeconds(valueMs: number): number {
  return Math.max(0, Math.floor(valueMs / 1000));
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateCode(): string {
  const value = crypto.randomInt(0, 1_000_000);
  return String(value).padStart(6, '0');
}

function generateSessionToken(): string {
  return crypto.randomUUID();
}

function resolveCooldownForExistingAttempts(attemptCount: number): number {
  if (attemptCount <= 0) {
    return 0;
  }
  const index = Math.min(attemptCount - 1, RESEND_COOLDOWN_STEPS_SECONDS.length - 1);
  return RESEND_COOLDOWN_STEPS_SECONDS[index];
}

function resolveNextCooldownAfterSend(newAttemptCount: number): number {
  return resolveCooldownForExistingAttempts(newAttemptCount);
}

function buildIssueEmailInsertPayload(params: {
  userId: number | null;
  draftId: number | null;
  draftTokenHash: string | null;
  draftStep: number | null;
  email: string;
  purpose: EmailChallengePurpose;
  codeHash: string;
  attemptNumber: number;
  maxAttempts: number;
  cooldownSeconds: number;
  expiresAt: Date;
  sentAt: Date;
  deliveryProvider: string;
}) {
  const columns = [
    'user_id',
    'draft_id',
    'draft_token_hash',
    'draft_step',
    'email',
    'purpose',
    'code_hash',
    'send_attempt_number',
    'failed_attempts',
    'max_attempts',
    'cooldown_seconds',
    'expires_at',
    'sent_at',
    'delivery_provider',
    'status',
  ] as const;
  const values: (string | number | null | Date)[] = [
    params.userId,
    params.draftId,
    params.draftTokenHash,
    params.draftStep,
    params.email,
    params.purpose,
    params.codeHash,
    params.attemptNumber,
    0,
    params.maxAttempts,
    params.cooldownSeconds,
    params.expiresAt,
    params.sentAt,
    params.deliveryProvider,
    'sent',
  ];
  return { columns, values };
}

export type EmailCodeSendResult =
  | {
      allowed: true;
      requestId: number;
      code: string;
      attemptNumber: number;
      expiresAt: Date;
      cooldownSec: number;
      dailyRemaining: number;
      resendType: 'initial' | 'resend';
    }
  | {
      allowed: false;
      code: 'EMAIL_RESEND_RATE_LIMITED';
      retryAfterSeconds: number;
      dailyRemaining: number;
    };

type EmailCodeQueryParam = string | number | null;

export async function issueEmailCodeChallenge(params: {
  email: string;
  purpose: EmailChallengePurpose;
  userId?: number | null;
  draftId?: number | null;
  draftTokenHash?: string | null;
  draftStep?: number | null;
  deliveryProvider?: string;
  now?: Date;
}): Promise<EmailCodeSendResult> {
  const email = params.email.trim().toLowerCase();
  const userId = params.userId ?? null;
  const now = params.now ?? new Date();
  const deliveryProvider = (params.deliveryProvider ?? 'brevo').trim() || 'brevo';

  const whereEmail = 'email = ?';
  const whereDraft = params.draftId && params.draftTokenHash ? ' AND draft_id = ? AND draft_token_hash = ?' : '';
  const queryParams: EmailCodeQueryParam[] = [email];
  if (params.draftId && params.draftTokenHash) {
    queryParams.push(params.draftId, params.draftTokenHash);
  }
  queryParams.push(params.purpose);

  const [rows] = await authDb.query<EmailCodeChallengeRow[]>(
    `
      SELECT id, sent_at, expires_at, status
      FROM email_code_challenges
      WHERE ${whereEmail} ${whereDraft ? 'AND user_id IS NULL' : ''}
        AND purpose = ?
        AND sent_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
      ORDER BY sent_at DESC
    `,
    queryParams,
  );

  const attemptsInLast24h = rows.length;
  if (attemptsInLast24h >= DAILY_RESEND_LIMIT) {
    const oldestInWindow = rows[rows.length - 1];
    const oldestSentAt = toDate(oldestInWindow.sent_at)!.getTime();
    const retryAtMs = oldestSentAt + 24 * 60 * 60 * 1000;
    const retryAfterSeconds = Math.max(1, floorPositiveSeconds(retryAtMs - now.getTime()));

    return {
      allowed: false,
      code: 'EMAIL_RESEND_RATE_LIMITED',
      retryAfterSeconds,
      dailyRemaining: 0,
    };
  }

  const requiredCooldown = resolveCooldownForExistingAttempts(attemptsInLast24h);
  const lastRequest = rows[0];
  if (lastRequest && requiredCooldown > 0) {
    const lastSentAtMs = toDate(lastRequest.sent_at)!.getTime();
    const elapsedSeconds = floorPositiveSeconds(now.getTime() - lastSentAtMs);
    if (elapsedSeconds < requiredCooldown) {
      return {
        allowed: false,
        code: 'EMAIL_RESEND_RATE_LIMITED',
        retryAfterSeconds: requiredCooldown - elapsedSeconds,
        dailyRemaining: DAILY_RESEND_LIMIT - attemptsInLast24h,
      };
    }
  }

  const code = generateCode();
  const attemptNumber = attemptsInLast24h + 1;
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60 * 1000);
  const cooldownSecondsApplied = resolveCooldownForExistingAttempts(attemptsInLast24h);

  const insertPayload = buildIssueEmailInsertPayload({
    userId,
    draftId: params.draftId ?? null,
    draftTokenHash: params.draftTokenHash ?? null,
    draftStep: params.draftStep ?? null,
    email,
    purpose: params.purpose,
    codeHash: hashValue(code),
    attemptNumber,
    maxAttempts: MAX_FAILED_ATTEMPTS,
    cooldownSeconds: cooldownSecondsApplied,
    expiresAt,
    sentAt: now,
    deliveryProvider,
  });
  const placeholders = insertPayload.values.map(() => '?').join(', ');
  const [insertResult] = await authDb.query<ResultSetHeader>(
    `
      INSERT INTO email_code_challenges
        (${insertPayload.columns.join(', ')})
      VALUES (${placeholders})
    `,
    insertPayload.values
  );

  return {
    allowed: true,
    requestId: Number(insertResult.insertId),
    code,
    attemptNumber,
    expiresAt,
    cooldownSec: resolveNextCooldownAfterSend(attemptNumber),
    dailyRemaining: Math.max(0, DAILY_RESEND_LIMIT - attemptNumber),
    resendType: attemptNumber === 1 ? 'initial' : 'resend',
  };
}

export async function deleteEmailCodeChallenge(requestId: number) {
  await authDb.query(
    `
      DELETE FROM email_code_challenges
      WHERE id = ?
    `,
    [requestId]
  );
}

export type EmailVerificationStatusResult =
  | { status: 'verified'; verifiedAt: Date | null }
  | { status: 'expired'; expiresAt: Date | null }
  | { status: 'pending'; expiresAt: Date | null };

export async function getEmailVerificationStatus(params: {
  email: string;
  now?: Date;
  draftId?: number | null;
  draftTokenHash?: string | null;
}): Promise<EmailVerificationStatusResult> {
  const email = params.email.trim().toLowerCase();
  const now = params.now ?? new Date();

  if (!params.draftId || !params.draftTokenHash) {
    const [userRows] = await authDb.query<RowDataPacket[]>(
      `
        SELECT email_verified_at
        FROM users
        WHERE email = ?
        LIMIT 1
      `,
      [email]
    );

    const verifiedAt = toDate(userRows[0]?.email_verified_at ?? null);
    if (verifiedAt) {
      return { status: 'verified', verifiedAt };
    }
  }

  if (params.draftId && params.draftTokenHash) {
    const [draftRows] = await authDb.query<EmailCodeChallengeRow[]>(
      `
        SELECT email_verified_at AS verified_at
        FROM registration_drafts
        WHERE id = ? AND draft_token_hash = ? AND status = 'OPEN'
        LIMIT 1
      `,
      [params.draftId, params.draftTokenHash]
    );
    const draftVerifiedAt = toDate(draftRows[0]?.verified_at ?? null);
    if (draftVerifiedAt) {
      return { status: 'verified', verifiedAt: draftVerifiedAt };
    }
  }

  const draftFilter = params.draftId && params.draftTokenHash
    ? 'draft_id = ? AND draft_token_hash = ?'
    : 'draft_id IS NULL';
  const challengeParams: EmailCodeQueryParam[] = [email];
  if (params.draftId && params.draftTokenHash) {
    challengeParams.push(params.draftId, params.draftTokenHash);
  }
  const [rows] = await authDb.query<EmailCodeChallengeRow[]>(
    `
      SELECT id, expires_at, status
      FROM email_code_challenges
      WHERE email = ?
        AND purpose = 'verify_email'
        AND ${draftFilter}
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    challengeParams
  );

  const latest = rows[0];
  const expiresAt = toDate(latest?.expires_at ?? null);
  if (latest && expiresAt && expiresAt.getTime() <= now.getTime()) {
    await authDb.query(
      `
        UPDATE email_code_challenges
        SET status = 'expired'
        WHERE id = ?
      `,
      [latest.id]
    );
    return { status: 'expired', expiresAt };
  }

  return { status: 'pending', expiresAt };
}

export type VerifyEmailCodeResult =
  | { status: 'verified'; verifiedAt: Date; challengeId: number }
  | { status: 'invalid'; remainingAttempts: number }
  | { status: 'expired'; expiresAt: Date | null }
  | { status: 'locked' }
  | { status: 'missing' };

export async function verifyEmailCode(params: {
  email: string;
  code: string;
  now?: Date;
  draftId?: number | null;
  draftTokenHash?: string | null;
}, options?: {
  db?: Queryable;
  consumeCode?: boolean;
}): Promise<VerifyEmailCodeResult> {
  const db = options?.db ?? authDb;
  const shouldConsumeCode = options?.consumeCode ?? true;
  const email = params.email.trim().toLowerCase();
  const code = String(params.code ?? '').replace(/\D/g, '');
  const now = params.now ?? new Date();
  const hasDraftContext = Boolean(params.draftId && params.draftTokenHash);
  const draftFilter = hasDraftContext ? 'AND draft_id = ? AND draft_token_hash = ?' : 'AND draft_id IS NULL';
  const draftQueryParams: EmailCodeQueryParam[] = [email];
  if (hasDraftContext) {
    draftQueryParams.push(params.draftId as number, params.draftTokenHash as string);
  }

  const [rows] = await db.query<EmailCodeChallengeRow[]>(
    `
      SELECT *
      FROM email_code_challenges
      WHERE email = ?
        AND purpose = 'verify_email'
        ${draftFilter}
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    draftQueryParams
  );

  const latest = rows[0];
  if (!latest) {
    return { status: 'missing' };
  }

  const expiresAt = toDate(latest.expires_at);
  if (!expiresAt || expiresAt.getTime() <= now.getTime() || latest.status === 'expired') {
    await db.query(
      `
        UPDATE email_code_challenges
        SET status = 'expired'
        WHERE id = ?
      `,
      [latest.id]
    );
    return { status: 'expired', expiresAt };
  }

  if (latest.status === 'locked') {
    return { status: 'locked' };
  }

  if (latest.status !== 'sent') {
    return { status: 'missing' };
  }

  if (code.length !== 6 || latest.code_hash !== hashValue(code)) {
    const failedAttempts = Number(latest.failed_attempts ?? 0) + 1;
    const shouldLock = failedAttempts >= Number(latest.max_attempts ?? MAX_FAILED_ATTEMPTS);
    await db.query(
      `
        UPDATE email_code_challenges
        SET failed_attempts = ?, status = ?
        WHERE id = ?
      `,
      [failedAttempts, shouldLock ? 'locked' : latest.status, latest.id]
    );
    if (shouldLock) {
      return { status: 'locked' };
    }
    return {
      status: 'invalid',
      remainingAttempts: Math.max(0, Number(latest.max_attempts ?? MAX_FAILED_ATTEMPTS) - failedAttempts),
    };
  }

  if (shouldConsumeCode) {
    await db.query(
      `
        UPDATE email_code_challenges
        SET status = 'verified', verified_at = ?
        WHERE id = ?
      `,
      [now, latest.id]
    );

    if (hasDraftContext) {
      await db.query(
        `
          UPDATE registration_drafts
          SET email_verified_at = COALESCE(email_verified_at, ?)
          WHERE id = ? AND draft_token_hash = ? AND status = 'OPEN'
        `,
        [now, params.draftId, params.draftTokenHash]
      );
    } else {
      await db.query(
        `
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, ?)
          WHERE email = ?
        `,
        [now, email]
      );
    }
  }

  return {
    status: 'verified',
    verifiedAt: now,
    challengeId: latest.id,
  };
}

export type VerifyPasswordResetCodeResult =
  | {
      status: 'verified';
      challengeId: number;
      resetSessionToken: string;
      expiresAt: Date;
    }
  | { status: 'invalid'; remainingAttempts: number }
  | { status: 'expired'; expiresAt: Date | null }
  | { status: 'locked' }
  | { status: 'missing' };

export async function verifyPasswordResetCode(params: {
  email: string;
  code: string;
  now?: Date;
}): Promise<VerifyPasswordResetCodeResult> {
  const email = params.email.trim().toLowerCase();
  const code = String(params.code ?? '').replace(/\D/g, '');
  const now = params.now ?? new Date();

  const [rows] = await authDb.query<EmailCodeChallengeRow[]>(
    `
      SELECT *
      FROM email_code_challenges
      WHERE email = ?
        AND purpose = 'password_reset'
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    [email]
  );

  const latest = rows[0];
  if (!latest) {
    return { status: 'missing' };
  }

  const expiresAt = toDate(latest.expires_at);
  if (!expiresAt || expiresAt.getTime() <= now.getTime() || latest.status === 'expired') {
    await authDb.query(
      `
        UPDATE email_code_challenges
        SET status = 'expired'
        WHERE id = ?
      `,
      [latest.id]
    );
    return { status: 'expired', expiresAt };
  }

  if (latest.status === 'locked') {
    return { status: 'locked' };
  }

  if (latest.status !== 'sent') {
    return { status: 'missing' };
  }

  if (code.length !== 6 || latest.code_hash !== hashValue(code)) {
    const failedAttempts = Number(latest.failed_attempts ?? 0) + 1;
    const shouldLock = failedAttempts >= Number(latest.max_attempts ?? MAX_FAILED_ATTEMPTS);
    await authDb.query(
      `
        UPDATE email_code_challenges
        SET failed_attempts = ?, status = ?
        WHERE id = ?
      `,
      [failedAttempts, shouldLock ? 'locked' : latest.status, latest.id]
    );
    if (shouldLock) {
      return { status: 'locked' };
    }
    return {
      status: 'invalid',
      remainingAttempts: Math.max(0, Number(latest.max_attempts ?? MAX_FAILED_ATTEMPTS) - failedAttempts),
    };
  }

  const resetSessionToken = generateSessionToken();
  const sessionExpiresAt = new Date(now.getTime() + RESET_SESSION_TTL_MINUTES * 60 * 1000);
  await authDb.query(
    `
      UPDATE email_code_challenges
      SET
        status = 'verified',
        verified_at = ?,
        session_token_hash = ?,
        session_expires_at = ?
      WHERE id = ?
    `,
    [now, hashValue(resetSessionToken), sessionExpiresAt, latest.id]
  );

  return {
    status: 'verified',
    challengeId: latest.id,
    resetSessionToken,
    expiresAt: sessionExpiresAt,
  };
}

export type ConfirmPasswordResetResult =
  | { status: 'consumed'; consumedAt: Date }
  | { status: 'invalid' }
  | { status: 'expired'; expiresAt: Date | null };

export async function confirmPasswordReset(params: {
  email: string;
  resetSessionToken: string;
  passwordHash: string;
  now?: Date;
}): Promise<ConfirmPasswordResetResult> {
  const email = params.email.trim().toLowerCase();
  const token = String(params.resetSessionToken ?? '').trim();
  const now = params.now ?? new Date();

  const [rows] = await authDb.query<EmailCodeChallengeRow[]>(
    `
      SELECT *
      FROM email_code_challenges
      WHERE email = ?
        AND purpose = 'password_reset'
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    [email]
  );

  const latest = rows[0];
  if (!latest) {
    return { status: 'invalid' };
  }

  const sessionExpiresAt = toDate(latest.session_expires_at);
  if (
    latest.status !== 'verified' ||
    !latest.session_token_hash ||
    !token ||
    latest.session_token_hash !== hashValue(token)
  ) {
    return { status: 'invalid' };
  }

  if (!sessionExpiresAt || sessionExpiresAt.getTime() <= now.getTime()) {
    await authDb.query(
      `
        UPDATE email_code_challenges
        SET status = 'expired'
        WHERE id = ?
      `,
      [latest.id]
    );
    return { status: 'expired', expiresAt: sessionExpiresAt };
  }

  await authDb.query(
    `
      UPDATE users
      SET
        password_hash = ?,
        token_version = COALESCE(token_version, 1) + 1
      WHERE email = ?
    `,
    [params.passwordHash, email]
  );
  await authDb.query(
    `
      UPDATE email_code_challenges
      SET status = 'consumed', consumed_at = ?
      WHERE id = ?
    `,
    [now, latest.id]
  );

  return {
    status: 'consumed',
    consumedAt: now,
  };
}

export function hashEmailChallengeValue(value: string) {
  return hashValue(value);
}

export const emailCodeChallengePolicy = {
  expirationMinutes: CODE_TTL_MINUTES,
  resetSessionTtlMinutes: RESET_SESSION_TTL_MINUTES,
  cooldownStepsSeconds: [...RESEND_COOLDOWN_STEPS_SECONDS],
  dailyLimit: DAILY_RESEND_LIMIT,
  maxAttempts: MAX_FAILED_ATTEMPTS,
};
