"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const firebaseAdmin_1 = __importDefault(require("../config/firebaseAdmin"));
const connection_1 = __importDefault(require("../database/connection"));
function buildUserPayload(row, profileType) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone ?? null,
        address: row.address ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        role: profileType,
    };
}
function hasCompleteProfile(row) {
    return !!(row.phone && row.city && row.state && row.address);
}
function signToken(id, role) {
    return jsonwebtoken_1.default.sign({ id, role }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '7d' });
}
class AuthController {
    async register(req, res) {
        const { name, email, password, phone, address, city, state, profileType, } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
        }
        const normalizedProfile = profileType === 'broker' ? 'broker' : 'client';
        try {
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUserRows.length > 0) {
                return res.status(409).json({ error: 'Este email já está em uso.' });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            const [userResult] = await connection_1.default.query(`
          INSERT INTO users (name, email, password_hash, phone, address, city, state)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [name, email, passwordHash, phone ?? null, address ?? null, city ?? null, state ?? null]);
            const userId = userResult.insertId;
            if (normalizedProfile === 'broker') {
                await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [userId, req.body.creci ?? '', 'pending_verification']);
            }
            const token = signToken(userId, normalizedProfile);
            return res.status(201).json({
                user: buildUserPayload({ id: userId, name, email, phone, address, city, state }, normalizedProfile),
                token,
                needsCompletion: !hasCompleteProfile({ phone, city, state, address }),
            });
        }
        catch (error) {
            console.error('Erro no registro:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async login(req, res) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
        }
        try {
            const [rows] = await connection_1.default.query(`
          SELECT u.id, u.name, u.email, u.password_hash, u.phone, u.address, u.city, u.state,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.email = ?
        `, [email]);
            if (rows.length === 0) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const user = rows[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, String(user.password_hash));
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const profile = user.role === 'broker' ? 'broker' : 'client';
            const token = signToken(user.id, profile);
            return res.json({
                user: buildUserPayload(user, profile),
                token,
                needsCompletion: !hasCompleteProfile(user),
            });
        }
        catch (error) {
            console.error('Erro no login:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async google(req, res) {
        const { idToken, profileType } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'idToken do Google é obrigatório.' });
        }
        const normalizedProfile = profileType === 'broker' ? 'broker' : 'client';
        try {
            const decoded = await firebaseAdmin_1.default.auth().verifyIdToken(idToken);
            const uid = decoded.uid;
            const email = decoded.email;
            const displayName = decoded.name || decoded.email?.split('@')[0] || `User-${uid}`;
            if (!email) {
                return res.status(400).json({ error: 'Email não disponível no token do Google.' });
            }
            const [existingRows] = await connection_1.default.query('SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.state, u.firebase_uid, b.id AS broker_id FROM users u LEFT JOIN brokers b ON u.id = b.id WHERE u.firebase_uid = ? OR u.email = ? LIMIT 1', [uid, email]);
            let userId;
            let userName = displayName;
            let phone = null;
            let address = null;
            let city = null;
            let state = null;
            let hasBrokerRow = false;
            if (existingRows.length > 0) {
                const row = existingRows[0];
                userId = row.id;
                userName = row.name || displayName;
                phone = row.phone ?? null;
                address = row.address ?? null;
                city = row.city ?? null;
                state = row.state ?? null;
                hasBrokerRow = !!row.broker_id;
                if (!row.firebase_uid) {
                    await connection_1.default.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, userId]);
                }
            }
            else {
                const [result] = await connection_1.default.query('INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)', [uid, email, displayName]);
                userId = result.insertId;
            }
            if (normalizedProfile === 'broker' && !hasBrokerRow) {
                await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [userId, '', 'pending_verification']);
            }
            const token = signToken(userId, normalizedProfile);
            return res.json({
                user: buildUserPayload({ id: userId, name: userName, email, phone, address, city, state }, normalizedProfile),
                token,
                needsCompletion: !hasCompleteProfile({ phone, city, state, address }),
            });
        }
        catch (error) {
            console.error('Erro no login com Google:', error);
            return res.status(401).json({ error: 'Token do Google inválido.' });
        }
    }
}
exports.authController = new AuthController();
