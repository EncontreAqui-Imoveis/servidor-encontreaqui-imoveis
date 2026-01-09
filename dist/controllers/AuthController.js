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
        broker_status: row.broker_status ?? null,
    };
}
function hasCompleteProfile(row) {
    return !!(row.phone && row.city && row.state && row.address);
}
function signToken(id, role) {
    return jsonwebtoken_1.default.sign({ id, role }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '7d' });
}
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout while waiting for ${label}`));
        }, ms);
        promise
            .then((value) => {
            clearTimeout(timer);
            resolve(value);
        })
            .catch((error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
class AuthController {
    async checkEmail(req, res) {
        const email = String(req.query.email ?? req.body?.email ?? '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email e obrigatorio.' });
        }
        try {
            const [rows] = await connection_1.default.query('SELECT id, firebase_uid FROM users WHERE email = ? LIMIT 1', [email]);
            const exists = rows.length > 0;
            const hasFirebaseUid = exists && rows[0].firebase_uid != null;
            return res.status(200).json({ exists, hasFirebaseUid });
        }
        catch (error) {
            console.error('Erro ao verificar email:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
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
                 CASE
                   WHEN b.id IS NOT NULL AND b.status IN ('approved', 'pending_verification') THEN 'broker'
                   ELSE 'client'
                 END AS role,
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
        const requestedProfile = profileType === 'broker' ? 'broker' : profileType === 'client' ? 'client' : 'auto';
        const autoMode = requestedProfile === 'auto';
        try {
            const decoded = await withTimeout(firebaseAdmin_1.default.auth().verifyIdToken(idToken), 8000, 'firebase token verification');
            const uid = decoded.uid;
            const email = decoded.email;
            const displayName = decoded.name || decoded.email?.split('@')[0] || `User-${uid}`;
            if (!email) {
                return res.status(400).json({ error: 'Email não disponível no token do Google.' });
            }
            const [existingRows] = await connection_1.default.query(`SELECT u.id, u.name, u.email, u.phone, u.address, u.city, u.state, u.firebase_uid,
                b.id AS broker_id, b.status AS broker_status,
                bd.status AS broker_documents_status
           FROM users u
           LEFT JOIN brokers b ON u.id = b.id
           LEFT JOIN broker_documents bd ON u.id = bd.broker_id
          WHERE u.firebase_uid = ? OR u.email = ?
          LIMIT 1`, [uid, email]);
            let userId;
            let userName = displayName;
            let phone = null;
            let address = null;
            let city = null;
            let state = null;
            let hasBrokerRow = false;
            let createdNow = false;
            let blockedBrokerRequest = false;
            let effectiveProfile = 'client';
            let requiresDocuments = false;
            let roleLocked = false;
            let brokerStatus = null;
            let brokerDocumentsStatus = null;
            let hasBrokerDocuments = false;
            if (existingRows.length > 0) {
                const row = existingRows[0];
                userId = row.id;
                userName = row.name || displayName;
                phone = row.phone ?? null;
                address = row.address ?? null;
                city = row.city ?? null;
                state = row.state ?? null;
                hasBrokerRow = !!row.broker_id;
                brokerStatus = row.broker_status ?? null;
                brokerDocumentsStatus = row.broker_documents_status ?? null;
                hasBrokerDocuments = brokerDocumentsStatus != null;
                blockedBrokerRequest = brokerStatus === 'rejected';
                if (hasBrokerRow && !blockedBrokerRequest) {
                    effectiveProfile = 'broker';
                }
                else {
                    effectiveProfile = 'client';
                    requiresDocuments = hasBrokerRow;
                }
                if (!row.firebase_uid) {
                    await connection_1.default.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, userId]);
                }
            }
            else {
                if (autoMode) {
                    return res.json({
                        requiresProfileChoice: true,
                        pending: { email, name: displayName },
                        isNewUser: true,
                        roleLocked: false,
                        needsCompletion: true,
                        requiresDocuments: false,
                    });
                }
                const [result] = await connection_1.default.query('INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)', [uid, email, displayName]);
                userId = result.insertId;
                createdNow = true;
                effectiveProfile = requestedProfile === 'broker' ? 'broker' : 'client';
                if (requestedProfile === 'broker') {
                    await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [userId, null, 'pending_verification']);
                    brokerStatus = 'pending_verification';
                    hasBrokerRow = true;
                    requiresDocuments = true;
                }
            }
            if (!autoMode && requestedProfile === 'broker') {
                if (blockedBrokerRequest) {
                    effectiveProfile = 'client';
                    roleLocked = true;
                    requiresDocuments = true;
                }
                else {
                    effectiveProfile = 'broker';
                    roleLocked = false;
                    if (!hasBrokerRow) {
                        await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [userId, null, 'pending_verification']);
                        brokerStatus = 'pending_verification';
                        hasBrokerRow = true;
                    }
                    requiresDocuments = (brokerStatus ?? '') !== 'approved';
                }
            }
            else if (!autoMode && requestedProfile === 'client') {
                effectiveProfile = blockedBrokerRequest ? 'client' : effectiveProfile;
                roleLocked = blockedBrokerRequest;
            }
            else if (autoMode) {
                roleLocked = blockedBrokerRequest || effectiveProfile === 'broker';
                requiresDocuments =
                    effectiveProfile === 'broker' && (brokerStatus ?? '') !== 'approved';
                if (effectiveProfile === 'broker' && blockedBrokerRequest) {
                    effectiveProfile = 'client';
                }
            }
            const needsCompletion = !hasCompleteProfile({ phone, city, state, address });
            const brokerDocsRequired = effectiveProfile === 'broker' &&
                (!hasBrokerDocuments || brokerDocumentsStatus === 'rejected');
            requiresDocuments = brokerDocsRequired;
            const token = signToken(userId, effectiveProfile);
            return res.json({
                user: buildUserPayload({
                    id: userId,
                    name: userName,
                    email,
                    phone,
                    address,
                    city,
                    state,
                    broker_status: brokerStatus,
                }, effectiveProfile),
                token,
                needsCompletion,
                requiresDocuments,
                blockedBrokerRequest,
                roleLocked,
                isNewUser: createdNow,
            });
        }
        catch (error) {
            console.error('Google auth error:', error);
            const details = error?.sqlMessage || error?.message || String(error);
            const message = String(details).toLowerCase();
            const status = message.includes('timeout') ? 504 : 500;
            return res.status(status).json({
                error: 'Erro ao autenticar com Google.',
                details,
            });
        }
    }
}
exports.authController = new AuthController();
