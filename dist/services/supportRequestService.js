"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORT_REQUEST_COOLDOWN_MS = void 0;
exports.evaluateSupportRequestCooldown = evaluateSupportRequestCooldown;
exports.SUPPORT_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
function evaluateSupportRequestCooldown(lastRequestAt, now = new Date()) {
    if (!lastRequestAt) {
        return { allowed: true, retryAfterSeconds: 0 };
    }
    const elapsedMs = now.getTime() - lastRequestAt.getTime();
    if (elapsedMs >= exports.SUPPORT_REQUEST_COOLDOWN_MS) {
        return { allowed: true, retryAfterSeconds: 0 };
    }
    const remainingMs = exports.SUPPORT_REQUEST_COOLDOWN_MS - elapsedMs;
    return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
}
