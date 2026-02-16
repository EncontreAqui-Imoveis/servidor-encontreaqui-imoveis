import crypto from 'crypto';

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

interface OtpSession {
  sessionToken: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  invalidated: boolean;
  attempts: number;
}

const OTP_TTL_MS = 5 * 60 * 1000;

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

class PhoneOtpService {
  private readonly sessionsByToken = new Map<string, OtpSession>();
  private readonly activeTokenByPhone = new Map<string, string>();

  requestOtp(rawPhone: string): OtpIssueResult {
    const phone = normalizePhone(rawPhone);
    this.invalidateActiveByPhone(phone);
    return this.createSession(phone);
  }

  resendOtp(sessionToken: string): OtpIssueResult | null {
    const existing = this.sessionsByToken.get(sessionToken);
    if (!existing || existing.invalidated) {
      return null;
    }

    this.invalidateSession(existing.sessionToken);
    return this.createSession(existing.phone);
  }

  verifyOtp(sessionToken: string, rawCode: string): OtpVerifyResult {
    const session = this.sessionsByToken.get(sessionToken);
    if (!session || session.invalidated) {
      return { ok: false, reason: 'INVALID_SESSION' };
    }

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      this.invalidateSession(session.sessionToken);
      return { ok: false, reason: 'EXPIRED' };
    }

    const sanitizedCode = String(rawCode).replace(/\D/g, '');
    if (sanitizedCode.length != 6 || session.codeHash !== hashCode(sanitizedCode)) {
      session.attempts += 1;
      return { ok: false, reason: 'INVALID_CODE' };
    }

    this.invalidateSession(session.sessionToken);
    return { ok: true, phone: session.phone };
  }

  clearForTests(): void {
    this.sessionsByToken.clear();
    this.activeTokenByPhone.clear();
  }

  private createSession(phone: string): OtpIssueResult {
    const code = generateCode();
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    const session: OtpSession = {
      sessionToken,
      phone,
      codeHash: hashCode(code),
      expiresAt,
      invalidated: false,
      attempts: 0,
    };

    this.sessionsByToken.set(sessionToken, session);
    this.activeTokenByPhone.set(phone, sessionToken);

    return { sessionToken, expiresAt, code };
  }

  private invalidateActiveByPhone(phone: string): void {
    const activeToken = this.activeTokenByPhone.get(phone);
    if (!activeToken) {
      return;
    }

    this.invalidateSession(activeToken);
  }

  private invalidateSession(sessionToken: string): void {
    const existing = this.sessionsByToken.get(sessionToken);
    if (!existing) {
      return;
    }

    existing.invalidated = true;
    this.sessionsByToken.delete(sessionToken);
    const activeToken = this.activeTokenByPhone.get(existing.phone);
    if (activeToken == sessionToken) {
      this.activeTokenByPhone.delete(existing.phone);
    }
  }
}

export const phoneOtpService = new PhoneOtpService();

