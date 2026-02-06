"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.isBroker = isBroker;
exports.isAdmin = isAdmin;
exports.isClient = isClient;
const connection_1 = __importDefault(require("../database/connection"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const jwtSecret = (0, env_1.requireEnv)('JWT_SECRET');
async function authMiddleware(req, res, next) {
    const { authorization } = req.headers;
    if (!authorization) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }
    const [scheme, token] = authorization.split(' ');
    if (!/^Bearer$/i.test(scheme) || !token) {
        return res.status(401).json({ error: 'Token mal formatado.' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, jwtSecret);
        req.userId = decoded.id;
        req.userRole = decoded.role;
        if (decoded.role === 'broker') {
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [decoded.id]);
            const brokers = brokerRows;
            if (brokers.length > 0 && brokers[0].status === 'rejected') {
                return res.status(403).json({
                    error: 'Sua conta de corretor foi rejeitada. Para se registrar como cliente, use um email diferente.',
                });
            }
        }
        return next();
    }
    catch (error) {
        console.error('Erro de autenticação:', error);
        return res.status(401).json({ error: 'Token inválido.' });
    }
}
async function isBroker(req, res, next) {
    try {
        const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [req.userId]);
        const brokers = brokerRows;
        if (brokers.length === 0) {
            return res.status(403).json({
                error: 'Acesso negado. Rota exclusiva para corretores.',
            });
        }
        if (brokers[0].status !== 'approved') {
            return res.status(403).json({
                error: 'Acesso negado. Sua conta de corretor n??o foi aprovada ou foi rejeitada. Para se registrar como cliente, use um email diferente.',
            });
        }
        req.userRole = 'broker';
        return next();
    }
    catch (error) {
        console.error('Erro ao verificar status do corretor:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
}
function isAdmin(req, res, next) {
    if (req.userRole !== 'admin') {
        return res.status(403).json({
            error: 'Acesso negado. Rota exclusiva para administradores.',
        });
    }
    return next();
}
function isClient(req, res, next) {
    if (req.userRole !== 'client') {
        return res.status(403).json({
            error: 'Acesso negado. Rota exclusiva para clientes.',
        });
    }
    return next();
}
