import { RowDataPacket } from 'mysql2';

import { authDb } from './authPersistenceService';

const VERIFICATION_EXPIRATION_MINUTES = 15;
const DAILY_RESEND_LIMIT = 5;
const RESEND_COOLDOWN_STEPS_SECONDS = [60, 90, 120] as const;

interface VerificationRequestRow extends RowDataPacket {
  id: number;
  sent_at: Date | string;
  expires_at: Date | string;
  status: 'sent' | 'verified' | 'expired' | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function floorPositiveSeconds(valueMs: number): number {
  return Math.max(0, Math.floor(valueMs / 1000));
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

export type EmailVerificationSendResult =
  | {
      allowed: true;
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

export async function issueEmailVerificationRequest(params: {
  email: string;
  userId?: number | null;
  now?: Date;
}): Promise<EmailVerificationSendResult> {
  const email = params.email.trim().toLowerCase();
  const userId = params.userId ?? null;
  const now = params.now ?? new Date();

  const [rows] = await authDb.query<VerificationRequestRow[]>(
    `
      SELECT id, sent_at, expires_at, status
      FROM email_verification_requests
      WHERE email = ?
        AND sent_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
      ORDER BY sent_at DESC
    `,
    [email]
  );

  const attemptsInLast24h = rows.length;
  if (attemptsInLast24h >= DAILY_RESEND_LIMIT) {
    const oldestInWindow = rows[rows.length - 1];
    const oldestSentAt = toDate(oldestInWindow.sent_at).getTime();
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
    const lastSentAtMs = toDate(lastRequest.sent_at).getTime();
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

  const attemptNumber = attemptsInLast24h + 1;
  const expiresAt = new Date(now.getTime() + VERIFICATION_EXPIRATION_MINUTES * 60 * 1000);
  const cooldownSecondsApplied = resolveCooldownForExistingAttempts(attemptsInLast24h);

  await authDb.query(
    `
      INSERT INTO email_verification_requests
        (user_id, email, attempt_number, cooldown_seconds, expires_at, sent_at, status)
      VALUES (?, ?, ?, ?, ?, ?, 'sent')
    `,
    [userId, email, attemptNumber, cooldownSecondsApplied, expiresAt, now]
  );

  return {
    allowed: true,
    attemptNumber,
    expiresAt,
    cooldownSec: resolveNextCooldownAfterSend(attemptNumber),
    dailyRemaining: Math.max(0, DAILY_RESEND_LIMIT - attemptNumber),
    resendType: attemptNumber == 1 ? 'initial' : 'resend',
  };
}

export type EmailVerificationCheckResult =
  | { status: 'verified'; verifiedAt: Date | null }
  | { status: 'expired'; expiresAt: Date | null }
  | { status: 'pending'; expiresAt: Date | null };

export async function checkEmailVerificationStatus(params: {
  email: string;
  isVerified: boolean;
  now?: Date;
}): Promise<EmailVerificationCheckResult> {
  const email = params.email.trim().toLowerCase();
  const now = params.now ?? new Date();

  const [rows] = await authDb.query<VerificationRequestRow[]>(
    `
      SELECT id, sent_at, expires_at, status
      FROM email_verification_requests
      WHERE email = ?
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    [email]
  );

  const latest = rows[0] ?? null;
  const latestExpiresAt = latest ? toDate(latest.expires_at) : null;

  if (params.isVerified) {
    if (latest) {
      await authDb.query(
        `
          UPDATE email_verification_requests
          SET status = 'verified'
          WHERE id = ?
        `,
        [latest.id]
      );
    }
    return { status: 'verified', verifiedAt: now };
  }

  if (latestExpiresAt && latestExpiresAt.getTime() <= now.getTime()) {
    if (latest && latest.status !== 'expired') {
      await authDb.query(
        `
          UPDATE email_verification_requests
          SET status = 'expired'
          WHERE id = ?
        `,
        [latest.id]
      );
    }
    return { status: 'expired', expiresAt: latestExpiresAt };
  }

  return { status: 'pending', expiresAt: latestExpiresAt };
}

export const emailVerificationPolicy = {
  expirationMinutes: VERIFICATION_EXPIRATION_MINUTES,
  cooldownStepsSeconds: [...RESEND_COOLDOWN_STEPS_SECONDS],
  dailyLimit: DAILY_RESEND_LIMIT,
};
