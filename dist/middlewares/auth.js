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
    if (!/^Bearer$/i.test(scheme) || !token) {
        return res.status(401).json({ error: 'Token mal formatado.' });
    }
    try {
        // 1) Tenta verificar como JWT próprio
        try {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            req.userId = decoded.id;
            req.userRole = decoded.role;
            // Verificação extra: se for broker, checar status
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
        catch (_jwtError) {
            // 2) Fallback: verificar token do Firebase
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(token);
            const firebase_uid = decodedToken.uid;
            const [userRows] = await connection_1.default.query(`SELECT u.id,
                u.role,
                b.status AS broker_status
           FROM users u
           LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ?`, [firebase_uid]);
            if (userRows.length === 0) {
                return res.status(404).json({ error: 'Usuário não encontrado.' });
            }
            const user = userRows[0];
            req.userId = user.id;
            // Define a role considerando o status do corretor
            const brokerStatus = (user.broker_status ?? '')
                .toString()
                .toLowerCase();
            const normalizedBrokerStatus = brokerStatus
                .normalize('NFD')
                .replace(/[^a-z]/g, '');
            if (['approved', 'verificado', 'verified', 'aprovado'].includes(normalizedBrokerStatus)) {
                req.userRole = 'broker';
            }
            else {
                req.userRole = user.role ?? 'user';
            }
            // Verificação extra: se for broker, confirmar que não está rejeitado
            if (req.userRole === 'broker') {
                const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [req.userId]);
                const brokers = brokerRows;
                if (brokers.length > 0 && brokers[0].status === 'rejected') {
                    return res.status(403).json({
                        error: 'Sua conta de corretor foi rejeitada. Para se registrar como cliente, use um email diferente.',
                    });
                }
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
async function isBroker(req, res, next) {
    if (req.userRole !== 'broker') {
        return res.status(403).json({
            error: 'Acesso negado. Rota exclusiva para corretores.',
        });
    }
    try {
        // Verificar se o corretor está aprovado
        const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [req.userId]);
        const brokers = brokerRows;
        if (brokers.length === 0 || brokers[0].status !== 'approved') {
            return res.status(403).json({
                error: 'Acesso negado. Sua conta de corretor não foi aprovada ou foi rejeitada. Para se registrar como cliente, use um email diferente.',
            });
        }
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
