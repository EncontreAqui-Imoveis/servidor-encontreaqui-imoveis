"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redactString = redactString;
exports.redactValue = redactValue;
exports.patchConsoleRedaction = patchConsoleRedaction;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_REGEX = /eyJ[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+/g;
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_QUERY_REGEX = /(token=)([^&\s]+)/gi;
const SENSITIVE_KEYS = [
    'authorization',
    'token',
    'password',
    'senha',
    'cookie',
    'email',
    'phone',
    'telefone',
    'cep',
    'firebase_private_key',
    'cloudinary_api_secret',
];
function shouldRedactKey(key) {
    const normalized = key.toLowerCase();
    return SENSITIVE_KEYS.some((item) => normalized.includes(item));
}
function redactString(value) {
    return value
        .replace(BEARER_REGEX, 'Bearer ***')
        .replace(JWT_REGEX, '***.***.***')
        .replace(TOKEN_QUERY_REGEX, '$1***')
        .replace(EMAIL_REGEX, '***@***');
}
function redactValue(value, depth = 0) {
    if (depth > 6)
        return '[redacted-depth]';
    if (typeof value === 'string')
        return redactString(value);
    if (Array.isArray(value))
        return value.map((entry) => redactValue(entry, depth + 1));
    if (!value || typeof value !== 'object')
        return value;
    const source = value;
    const sanitized = {};
    for (const [key, entry] of Object.entries(source)) {
        if (shouldRedactKey(key)) {
            sanitized[key] = '***';
            continue;
        }
        sanitized[key] = redactValue(entry, depth + 1);
    }
    return sanitized;
}
function sanitizeArgs(args) {
    return args.map((arg) => redactValue(arg));
}
function patchConsoleRedaction() {
    const original = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
    };
    console.log = (...args) => {
        original.log(...sanitizeArgs(args));
    };
    console.warn = (...args) => {
        original.warn(...sanitizeArgs(args));
    };
    console.error = (...args) => {
        original.error(...sanitizeArgs(args));
    };
}
