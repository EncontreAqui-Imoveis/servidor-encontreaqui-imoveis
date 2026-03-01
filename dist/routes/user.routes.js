"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const UserController_1 = require("../controllers/UserController");
const AuthController_1 = require("../controllers/AuthController");
const auth_1 = require("../middlewares/auth");
const userRoutes = (0, express_1.Router)();
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
userRoutes.post('/register', legacyAuthLimiter, (req, res) => AuthController_1.authController.register(req, res));
userRoutes.post('/login', legacyAuthLimiter, (req, res) => AuthController_1.authController.login(req, res));
userRoutes.post('/sync', UserController_1.userController.syncUser);
userRoutes.post('/auth/google', (req, res) => AuthController_1.authController.google(req, res));
userRoutes.post('/auth/firebase', UserController_1.userController.firebaseLogin);
userRoutes.get('/me', auth_1.authMiddleware, (req, res) => UserController_1.userController.getProfile(req, res));
userRoutes.put('/me', auth_1.authMiddleware, (req, res) => UserController_1.userController.updateProfile(req, res));
userRoutes.get('/me/properties', auth_1.authMiddleware, (req, res) => UserController_1.userController.getMyProperties(req, res));
userRoutes.get('/favorites', auth_1.authMiddleware, (req, res) => UserController_1.userController.listFavorites(req, res));
userRoutes.post('/favorites/:propertyId', auth_1.authMiddleware, (req, res) => UserController_1.userController.addFavorite(req, res));
userRoutes.delete('/favorites/:propertyId', auth_1.authMiddleware, (req, res) => UserController_1.userController.removeFavorite(req, res));
userRoutes.post('/support-request', auth_1.authMiddleware, (req, res) => UserController_1.userController.requestSupport(req, res));
userRoutes.get('/notifications', auth_1.authMiddleware, (req, res) => UserController_1.userController.listNotifications(req, res));
userRoutes.patch('/notifications/:id/read', auth_1.authMiddleware, (req, res) => UserController_1.userController.markNotificationRead(req, res));
userRoutes.post('/notifications/read-all', auth_1.authMiddleware, (req, res) => UserController_1.userController.markAllNotificationsRead(req, res));
userRoutes.post('/device-token', auth_1.authMiddleware, (req, res) => UserController_1.userController.registerDeviceToken(req, res));
userRoutes.delete('/device-token', auth_1.authMiddleware, (req, res) => UserController_1.userController.unregisterDeviceToken(req, res));
exports.default = userRoutes;
