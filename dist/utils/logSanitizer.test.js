"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const logSanitizer_1 = require("./logSanitizer");
(0, vitest_1.describe)('logSanitizer', () => {
    (0, vitest_1.it)('mascara bearer, jwt e email em strings', () => {
        const raw = 'Authorization: Bearer abc.def.ghi token=abc123 email=usuario@dominio.com';
        const redacted = (0, logSanitizer_1.redactString)(raw);
        (0, vitest_1.expect)(redacted).toContain('Bearer ***');
        (0, vitest_1.expect)(redacted).toContain('token=***');
        (0, vitest_1.expect)(redacted).toContain('***@***');
    });
    (0, vitest_1.it)('mascara chaves sensíveis em objetos', () => {
        const redacted = (0, logSanitizer_1.redactValue)({
            authorization: 'Bearer token',
            nested: { password: '123456', city: 'Rio Verde' },
        });
        (0, vitest_1.expect)(redacted.authorization).toBe('***');
        (0, vitest_1.expect)(redacted.nested.password).toBe('***');
        (0, vitest_1.expect)(redacted.nested.city).toBe('Rio Verde');
    });
});
