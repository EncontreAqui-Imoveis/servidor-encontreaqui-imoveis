"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
let isClient;
let isAdmin;
(0, vitest_1.beforeAll)(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    ({ isClient, isAdmin } = await Promise.resolve().then(() => __importStar(require('./auth'))));
});
function createResponseMock() {
    const json = vitest_1.vi.fn();
    const status = vitest_1.vi.fn().mockReturnValue({ json });
    return { status, json };
}
(0, vitest_1.describe)('isClient middleware', () => {
    (0, vitest_1.it)('permite quando role e client', () => {
        const req = { userRole: 'client' };
        const res = createResponseMock();
        const next = vitest_1.vi.fn();
        isClient(req, res, next);
        (0, vitest_1.expect)(next).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('bloqueia quando role nao e client', () => {
        const req = { userRole: 'broker' };
        const res = createResponseMock();
        const next = vitest_1.vi.fn();
        isClient(req, res, next);
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
        (0, vitest_1.expect)(res.status).toHaveBeenCalledWith(403);
    });
});
(0, vitest_1.describe)('isAdmin middleware', () => {
    (0, vitest_1.it)('permite quando role e admin', () => {
        const req = { userRole: 'admin' };
        const res = createResponseMock();
        const next = vitest_1.vi.fn();
        isAdmin(req, res, next);
        (0, vitest_1.expect)(next).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('bloqueia quando role nao e admin', () => {
        const req = { userRole: 'client' };
        const res = createResponseMock();
        const next = vitest_1.vi.fn();
        isAdmin(req, res, next);
        (0, vitest_1.expect)(next).not.toHaveBeenCalled();
        (0, vitest_1.expect)(res.status).toHaveBeenCalledWith(403);
    });
});
