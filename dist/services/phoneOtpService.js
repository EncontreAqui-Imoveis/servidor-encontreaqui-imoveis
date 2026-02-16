"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.phoneOtpService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const OTP_TTL_MS = 5 * 60 * 1000;
function normalizePhone(phone) {
    return String(phone).replace(/\D/g, '');
}
function hashCode(code) {
    return crypto_1.default.createHash('sha256').update(code).digest('hex');
}
function generateCode() {
    const value = crypto_1.default.randomInt(0, 1_000_000);
    return String(value).padStart(6, '0');
}
class PhoneOtpService {
    sessionsByToken = new Map();
    activeTokenByPhone = new Map();
    requestOtp(rawPhone) {
        const phone = normalizePhone(rawPhone);
        this.invalidateActiveByPhone(phone);
        return this.createSession(phone);
    }
    resendOtp(sessionToken) {
        const existing = this.sessionsByToken.get(sessionToken);
        if (!existing || existing.invalidated) {
            return null;
        }
        this.invalidateSession(existing.sessionToken);
        return this.createSession(existing.phone);
    }
    verifyOtp(sessionToken, rawCode) {
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
    clearForTests() {
        this.sessionsByToken.clear();
        this.activeTokenByPhone.clear();
    }
    createSession(phone) {
        const code = generateCode();
        const sessionToken = crypto_1.default.randomUUID();
        const expiresAt = new Date(Date.now() + OTP_TTL_MS);
        const session = {
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
    invalidateActiveByPhone(phone) {
        const activeToken = this.activeTokenByPhone.get(phone);
        if (!activeToken) {
            return;
        }
        this.invalidateSession(activeToken);
    }
    invalidateSession(sessionToken) {
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
exports.phoneOtpService = new PhoneOtpService();
