"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const AuthController_1 = require("../controllers/AuthController");
const auth_1 = require("../middlewares/auth");
const authRoutes = (0, express_1.Router)();
const authWindowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS);
const authLimit = Number(process.env.AUTH_RATE_LIMIT_MAX);
const authSensitiveLimiter = (0, express_rate_limit_1.default)({
    windowMs: Number.isFinite(authWindowMs) && authWindowMs > 0
        ? authWindowMs
        : 15 * 60 * 1000,
    limit: Number.isFinite(authLimit) && authLimit > 0 ? authLimit : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Muitas tentativas em rotas de autenticacao. Tente novamente em instantes.',
    },
});
authRoutes.post('/register', (req, res) => AuthController_1.authController.register(req, res));
authRoutes.post('/login', authSensitiveLimiter, (req, res) => AuthController_1.authController.login(req, res));
authRoutes.post('/google', authSensitiveLimiter, (req, res) => AuthController_1.authController.google(req, res));
authRoutes.post('/otp/request', authSensitiveLimiter, (req, res) => AuthController_1.authController.requestOtp(req, res));
authRoutes.post('/otp/resend', authSensitiveLimiter, (req, res) => AuthController_1.authController.resendOtp(req, res));
authRoutes.post('/otp/verify', (req, res) => AuthController_1.authController.verifyOtp(req, res));
authRoutes.post('/verify-phone', (req, res) => AuthController_1.authController.verifyPhone(req, res));
authRoutes.get('/check-email', authSensitiveLimiter, (req, res) => AuthController_1.authController.checkEmail(req, res));
authRoutes.post('/password-reset/request', authSensitiveLimiter, (req, res) => AuthController_1.authController.requestPasswordReset(req, res));
// Perfil
authRoutes.get('/me', auth_1.authMiddleware, (req, res) => {
    // delegar para user.routes GET /users/me, mas mantendo compatibilidade
    return res.redirect(307, '/users/me');
});
exports.default = authRoutes;
