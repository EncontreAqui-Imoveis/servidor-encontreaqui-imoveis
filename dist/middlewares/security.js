"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityHeaders = securityHeaders;
exports.enforceHttps = enforceHttps;
exports.buildCorsOptions = buildCorsOptions;
const ONE_YEAR_IN_SECONDS = 31536000;
function securityHeaders(_req, res, next) {
    res.setHeader('Strict-Transport-Security', `max-age=${ONE_YEAR_IN_SECONDS}; includeSubDomains`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
}
function enforceHttps(req, res, next) {
    const enforceHttpsInProxy = (process.env.ENFORCE_HTTPS ?? '').trim().toLowerCase() === 'true';
    if (!enforceHttpsInProxy) {
        next();
        return;
    }
    if (req.secure) {
        next();
        return;
    }
    const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '')
        .split(',')[0]
        .trim()
        .toLowerCase();
    if (forwardedProto === 'https') {
        next();
        return;
    }
    const host = req.headers.host;
    if (!host) {
        res.status(400).json({ error: 'Host ausente para redirecionamento HTTPS.' });
        return;
    }
    res.redirect(308, `https://${host}${req.originalUrl}`);
}
function buildCorsOptions() {
    const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0);
    if (allowedOrigins.length === 0) {
        return {
            origin: true,
            credentials: true,
        };
    }
    return {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
        credentials: true,
    };
}
