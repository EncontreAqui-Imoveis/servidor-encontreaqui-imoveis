"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const security_1 = require("./security");
function createResponseMock() {
    const headers = new Map();
    let statusCode = 200;
    let redirectCode = null;
    let redirectTarget = '';
    let jsonPayload;
    const res = {
        setHeader: (name, value) => {
            headers.set(name, Array.isArray(value) ? value.join(',') : value);
            return res;
        },
        status: (code) => {
            statusCode = code;
            return res;
        },
        json: (payload) => {
            jsonPayload = payload;
            return res;
        },
        redirect: (arg1, arg2) => {
            if (typeof arg1 === 'number' && typeof arg2 === 'string') {
                redirectCode = arg1;
                redirectTarget = arg2;
            }
            else if (typeof arg1 === 'string' && typeof arg2 === 'number') {
                redirectCode = arg2;
                redirectTarget = arg1;
            }
            else if (typeof arg1 === 'string') {
                redirectCode = 302;
                redirectTarget = arg1;
            }
            return res;
        },
    };
    return {
        res: res,
        headers,
        get statusCode() {
            return statusCode;
        },
        get redirectCode() {
            return redirectCode;
        },
        get redirectTarget() {
            return redirectTarget;
        },
        get jsonPayload() {
            return jsonPayload;
        },
    };
}
(0, vitest_1.describe)('securityHeaders', () => {
    (0, vitest_1.it)('adiciona cabecalhos de hardening', () => {
        const { res, headers } = createResponseMock();
        let nextCalled = false;
        (0, security_1.securityHeaders)({}, res, () => {
            nextCalled = true;
        });
        (0, vitest_1.expect)(nextCalled).toBe(true);
        (0, vitest_1.expect)(headers.get('Strict-Transport-Security')).toContain('max-age=');
        (0, vitest_1.expect)(headers.get('X-Content-Type-Options')).toBe('nosniff');
        (0, vitest_1.expect)(headers.get('X-Frame-Options')).toBe('DENY');
        (0, vitest_1.expect)(headers.get('Referrer-Policy')).toBe('no-referrer');
    });
});
(0, vitest_1.describe)('enforceHttps', () => {
    (0, vitest_1.it)('redireciona para https quando habilitado e request inseguro', () => {
        process.env.ENFORCE_HTTPS = 'true';
        const state = createResponseMock();
        const { res } = state;
        let nextCalled = false;
        (0, security_1.enforceHttps)({
            secure: false,
            headers: { host: 'example.com', 'x-forwarded-proto': 'http' },
            originalUrl: '/admin/properties',
        }, res, () => {
            nextCalled = true;
        });
        (0, vitest_1.expect)(nextCalled).toBe(false);
        (0, vitest_1.expect)(state.redirectCode).toBe(308);
        (0, vitest_1.expect)(state.redirectTarget).toBe('https://example.com/admin/properties');
    });
    (0, vitest_1.it)('permite seguir quando request ja esta em https', () => {
        process.env.ENFORCE_HTTPS = 'true';
        const { res } = createResponseMock();
        let nextCalled = false;
        (0, security_1.enforceHttps)({
            secure: true,
            headers: { host: 'example.com' },
            originalUrl: '/health',
        }, res, () => {
            nextCalled = true;
        });
        (0, vitest_1.expect)(nextCalled).toBe(true);
    });
});
(0, vitest_1.describe)('buildCorsOptions', () => {
    (0, vitest_1.it)('aceita origem configurada e bloqueia origem fora da lista', () => {
        process.env.CORS_ORIGINS = 'https://painel.exemplo.com,https://app.exemplo.com';
        const options = (0, security_1.buildCorsOptions)();
        const originFn = options.origin;
        let allowed;
        originFn('https://painel.exemplo.com', (_err, isAllowed) => {
            allowed = isAllowed;
        });
        (0, vitest_1.expect)(allowed).toBe(true);
        originFn('https://malicioso.exemplo.com', (_err, isAllowed) => {
            allowed = isAllowed;
        });
        (0, vitest_1.expect)(allowed).toBe(false);
    });
});
