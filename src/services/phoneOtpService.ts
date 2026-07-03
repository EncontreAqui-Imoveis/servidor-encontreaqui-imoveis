import crypto from 'crypto';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { authDb } from './authPersistenceService';

export interface OtpIssueResult {
  sessionToken: string;
  expiresAt: Date;
  code: string;
}

type OtpVerifyReason = 'INVALID_SESSION' | 'INVALID_CODE' | 'EXPIRED';

export interface OtpVerifyResult {
  ok: boolean;
  phone?: string;
  reason?: OtpVerifyReason;
}

interface AuthPhoneOtpRow extends RowDataPacket {
  id: number;
  phone: string;
  session_token: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  cooldown_seconds: number;
  sent_at: string | Date;
  expires_at: string | Date;
}

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_COOLDOWN_SECONDS = 60;

function normalizePhone(phone: string): string {
  return String(phone).replace(/\D/g, '');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  const value = crypto.randomInt(0, 1_000_000);
  return String(value).padStart(6, '0');
}

async function deleteExpiredOtps(): Promise<void> {
  await authDb.query<ResultSetHeader>(
    'DELETE FROM auth_phone_otps WHERE expires_at <= NOW()',
  );
}

async function getOtpBySessionToken(sessionToken: string): Promise<AuthPhoneOtpRow | null> {
  const [rows] = await authDb.query<AuthPhoneOtpRow[]>(
    `
      SELECT
        id,
        phone,
        session_token,
        code_hash,
        attempts,
        max_attempts,
        cooldown_seconds,
        sent_at,
        expires_at
      FROM auth_phone_otps
      WHERE session_token = ?
      LIMIT 1
    `,
    [sessionToken],
  );
  return rows[0] ?? null;
}

async function deleteOtpBySessionToken(sessionToken: string): Promise<void> {
  await authDb.query<ResultSetHeader>(
    'DELETE FROM auth_phone_otps WHERE session_token = ?',
    [sessionToken],
  );
}

async function deleteActiveOtpsByPhone(phone: string): Promise<void> {
  await authDb.query<ResultSetHeader>(
    `
      DELETE FROM auth_phone_otps
      WHERE phone = ? AND expires_at > NOW()
    `,
    [phone],
  );
}

class PhoneOtpService {
  async requestOtp(rawPhone: string): Promise<OtpIssueResult> {
    const phone = normalizePhone(rawPhone);
    await deleteExpiredOtps();
    await deleteActiveOtpsByPhone(phone);
    return this.createSession(phone);
  }

  async resendOtp(sessionToken: string): Promise<OtpIssueResult | null> {
    await deleteExpiredOtps();
    const existing = await getOtpBySessionToken(sessionToken);
    if (!existing) {
      return null;
    }

    const expiresAt = new Date(existing.expires_at);
    if (expiresAt.getTime() <= Date.now()) {
      await deleteOtpBySessionToken(existing.session_token);
      return null;
    }

    await deleteOtpBySessionToken(existing.session_token);
    return this.createSession(existing.phone);
  }

  async verifyOtp(sessionToken: string, rawCode: string): Promise<OtpVerifyResult> {
    await deleteExpiredOtps();
    const session = await getOtpBySessionToken(sessionToken);
    if (!session) {
      return { ok: false, reason: 'INVALID_SESSION' };
    }

    const now = Date.now();
    if (new Date(session.expires_at).getTime() <= now) {
      await deleteOtpBySessionToken(session.session_token);
      return { ok: false, reason: 'EXPIRED' };
    }

    const sanitizedCode = String(rawCode).replace(/\D/g, '');
    if (sanitizedCode.length !== 6 || session.code_hash !== hashCode(sanitizedCode)) {
      const nextAttempts = Number(session.attempts ?? 0) + 1;
      if (nextAttempts >= Number(session.max_attempts ?? OTP_MAX_ATTEMPTS)) {
        await deleteOtpBySessionToken(session.session_token);
      } else {
        await authDb.query<ResultSetHeader>(
          `
            UPDATE auth_phone_otps
            SET attempts = ?
            WHERE session_token = ?
          `,
          [nextAttempts, session.session_token],
        );
      }
      return { ok: false, reason: 'INVALID_CODE' };
    }

    await deleteOtpBySessionToken(session.session_token);
    return { ok: true, phone: session.phone };
  }

  async clearForTests(): Promise<void> {
    await authDb.query<ResultSetHeader>('DELETE FROM auth_phone_otps');
  }

  private async createSession(phone: string): Promise<OtpIssueResult> {
    const code = generateCode();
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await authDb.query<ResultSetHeader>(
      `
        INSERT INTO auth_phone_otps (
          phone,
          session_token,
          code_hash,
          attempts,
          max_attempts,
          cooldown_seconds,
          expires_at
        ) VALUES (?, ?, ?, 0, ?, ?, ?)
      `,
      [
        phone,
        sessionToken,
        hashCode(code),
        OTP_MAX_ATTEMPTS,
        OTP_COOLDOWN_SECONDS,
        expiresAt,
      ],
    );

    return { sessionToken, expiresAt, code };
  }
}

export const phoneOtpService = new PhoneOtpService();
export { deleteExpiredOtps as discardExpiredPhoneOtps };
