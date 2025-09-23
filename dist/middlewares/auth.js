"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.isBroker = isBroker;
exports.isAdmin = isAdmin;
const firebaseAdmin_1 = __importDefault(require("../config/firebaseAdmin"));
const connection_1 = __importDefault(require("../database/connection"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
async function authMiddleware(req, res, next) {
    const { authorization } = req.headers;
    if (!authorization) {
        return res.status(401).json({ error: 'Token não fornecido.' });
    }
    const [scheme, token] = authorization.split(' ');
    if (!/Bearer$/i.test(scheme) || !token) {
        return res.status(401).json({ error: 'Token mal formatado.' });
    }
    try {
        // Tenta verificar como JWT tradicional primeiro
        try {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            req.userId = decoded.id;
            req.userRole = decoded.role;
            return next();
        }
        catch (jwtError) {
            // Fallback para Firebase
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(token);
            const firebase_uid = decodedToken.uid;
            const [userRows] = await connection_1.default.query(`SELECT u.id, 
                u.role,
                b.status as broker_status
         FROM users u
         LEFT JOIN brokers b ON u.id = b.id
         WHERE u.firebase_uid = ?`, [firebase_uid]);
            if (userRows.length === 0) {
                return res.status(404).json({ error: 'Usuário não encontrado.' });
            }
            const user = userRows[0];
            req.userId = user.id;
            // Define a role correta considerando status do corretor
            const brokerStatus = (user.broker_status ?? '').toString().toLowerCase();
            const normalizedBrokerStatus = brokerStatus
                .normalize('NFD')
                .replace(/[^a-z]/g, '');
            if (['approved', 'verificado', 'verified', 'aprovado'].includes(normalizedBrokerStatus)) {
                req.userRole = 'broker';
            }
            else {
                req.userRole = user.role ?? 'user';
            }
            req.firebase_uid = firebase_uid;
            return next();
        }
    }
    catch (error) {
        console.error('Erro de autenticação:', error);
        return res.status(401).json({ error: 'Token inválido.' });
    }
}
function isBroker(req, res, next) {
    if (req.userRole !== 'broker') {
        return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para corretores.' });
    }
    return next();
}
function isAdmin(req, res, next) {
    if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Acesso negado. Rota exclusiva para administradores.' });
    }
    return next();
}
