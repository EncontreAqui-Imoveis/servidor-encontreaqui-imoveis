"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const supportRequestService_1 = require("./supportRequestService");
(0, vitest_1.describe)('evaluateSupportRequestCooldown', () => {
    (0, vitest_1.it)('allows when no previous request exists', () => {
        const result = (0, supportRequestService_1.evaluateSupportRequestCooldown)(null, new Date('2026-01-01T12:00:00Z'));
        (0, vitest_1.expect)(result.allowed).toBe(true);
        (0, vitest_1.expect)(result.retryAfterSeconds).toBe(0);
    });
    (0, vitest_1.it)('blocks when last request is inside cooldown', () => {
        const now = new Date('2026-01-01T12:00:00Z');
        const lastRequest = new Date(now.getTime() - 60 * 60 * 1000);
        const result = (0, supportRequestService_1.evaluateSupportRequestCooldown)(lastRequest, now);
        (0, vitest_1.expect)(result.allowed).toBe(false);
        (0, vitest_1.expect)(result.retryAfterSeconds).toBeGreaterThan(0);
    });
    (0, vitest_1.it)('allows when cooldown has expired', () => {
        const now = new Date('2026-01-02T12:00:00Z');
        const lastRequest = new Date(now.getTime() - supportRequestService_1.SUPPORT_REQUEST_COOLDOWN_MS - 1000);
        const result = (0, supportRequestService_1.evaluateSupportRequestCooldown)(lastRequest, now);
        (0, vitest_1.expect)(result.allowed).toBe(true);
        (0, vitest_1.expect)(result.retryAfterSeconds).toBe(0);
    });
});
