"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tempUploadCleanup = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const uploadMiddleware_1 = require("./uploadMiddleware");
function isObjectLike(value) {
    return !!value && typeof value === 'object';
}
function normalizePath(value) {
    return path_1.default.resolve(value);
}
function isWithinMediaTempDir(filePath) {
    const normalizedFilePath = normalizePath(filePath);
    const normalizedTempDir = normalizePath(uploadMiddleware_1.MEDIA_UPLOAD_DIR);
    return (normalizedFilePath === normalizedTempDir ||
        normalizedFilePath.startsWith(`${normalizedTempDir}${path_1.default.sep}`));
}
function collectUploadPaths(value, accumulator) {
    if (!value)
        return;
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectUploadPaths(entry, accumulator);
        }
        return;
    }
    if (!isObjectLike(value))
        return;
    const maybePath = value.path;
    if (typeof maybePath === 'string' && maybePath.length > 0) {
        if (isWithinMediaTempDir(maybePath)) {
            accumulator.add(normalizePath(maybePath));
        }
        return;
    }
    for (const nestedValue of Object.values(value)) {
        if (Array.isArray(nestedValue)) {
            collectUploadPaths(nestedValue, accumulator);
            continue;
        }
        if (isObjectLike(nestedValue) &&
            typeof nestedValue.path === 'string') {
            collectUploadPaths(nestedValue, accumulator);
        }
    }
}
async function cleanupPaths(paths) {
    const cleanupOps = [];
    for (const filePath of paths) {
        cleanupOps.push(fs_1.promises.unlink(filePath).catch(() => undefined));
    }
    await Promise.all(cleanupOps);
}
const tempUploadCleanup = (req, res, next) => {
    let finalized = false;
    const finalize = () => {
        if (finalized)
            return;
        finalized = true;
        const pathsToCleanup = new Set();
        collectUploadPaths(req.file, pathsToCleanup);
        collectUploadPaths(req.files, pathsToCleanup);
        if (pathsToCleanup.size > 0) {
            void cleanupPaths(pathsToCleanup);
        }
    };
    res.on('finish', finalize);
    res.on('close', finalize);
    next();
};
exports.tempUploadCleanup = tempUploadCleanup;
