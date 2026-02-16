"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CRECI_REGEX = void 0;
exports.normalizeCreci = normalizeCreci;
exports.hasValidCreci = hasValidCreci;
exports.CRECI_REGEX = /^\d{4,6}-?[A-Za-z]?$/;
function normalizeCreci(value) {
    if (value === undefined || value === null) {
        return '';
    }
    return String(value).trim().replace(/\s+/g, '').toUpperCase();
}
function hasValidCreci(value) {
    const normalized = normalizeCreci(value);
    return exports.CRECI_REGEX.test(normalized);
}
