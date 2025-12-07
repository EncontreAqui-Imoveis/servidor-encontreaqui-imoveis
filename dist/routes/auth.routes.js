"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const AuthController_1 = require("../controllers/AuthController");
const auth_1 = require("../middlewares/auth");
const authRoutes = (0, express_1.Router)();
authRoutes.post('/register', (req, res) => AuthController_1.authController.register(req, res));
authRoutes.post('/login', (req, res) => AuthController_1.authController.login(req, res));
authRoutes.post('/google', (req, res) => AuthController_1.authController.google(req, res));
// Perfil
authRoutes.get('/me', auth_1.authMiddleware, (req, res) => {
    // delegar para user.routes GET /users/me, mas mantendo compatibilidade
    return res.redirect(307, '/users/me');
});
exports.default = authRoutes;
