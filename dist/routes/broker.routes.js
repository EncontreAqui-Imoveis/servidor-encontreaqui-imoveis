"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const BrokerController_1 = require("../controllers/BrokerController");
const AuthController_1 = require("../controllers/AuthController");
const auth_1 = require("../middlewares/auth");
const uploadMiddleware_1 = require("../middlewares/uploadMiddleware");
const router = (0, express_1.Router)();
const legacyAuthWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS);
const legacyAuthLimit = Number(process.env.AUTH_RATE_LIMIT_MAX);
const legacyAuthLimiter = (0, express_rate_limit_1.default)({
    windowMs: Number.isFinite(legacyAuthWindowMs) && legacyAuthWindowMs > 0
        ? legacyAuthWindowMs
        : 15 * 60 * 1000,
    limit: Number.isFinite(legacyAuthLimit) && legacyAuthLimit > 0 ? legacyAuthLimit : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Muitas tentativas em rotas legadas de autenticacao. Use /auth/*.',
    },
});
router.post('/register', BrokerController_1.brokerController.register);
router.post('/login', legacyAuthLimiter, (req, res) => AuthController_1.authController.login(req, res));
router.post('/register-with-docs', uploadMiddleware_1.brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
]), BrokerController_1.brokerController.registerWithDocs);
router.use(auth_1.authMiddleware);
router.get('/approved', BrokerController_1.brokerController.listApproved);
router.post('/me/verify-documents', uploadMiddleware_1.brokerDocsUpload.fields([
    { name: 'creciFront', maxCount: 1 },
    { name: 'creciBack', maxCount: 1 },
    { name: 'selfie', maxCount: 1 },
]), BrokerController_1.brokerController.uploadVerificationDocs);
router.post('/me/request-upgrade', BrokerController_1.brokerController.requestUpgrade);
router.get('/me/properties', auth_1.isBroker, BrokerController_1.brokerController.getMyProperties);
router.get('/me/commissions', auth_1.isBroker, BrokerController_1.brokerController.getMyCommissions);
router.get('/me/performance-report', auth_1.isBroker, BrokerController_1.brokerController.getMyPerformanceReport);
router.get('/me/performance', auth_1.isBroker, BrokerController_1.brokerController.getMyPerformanceReport);
exports.default = router;
