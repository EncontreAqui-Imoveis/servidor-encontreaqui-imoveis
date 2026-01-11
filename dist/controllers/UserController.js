"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = __importDefault(require("../database/connection"));
const firebaseAdmin_1 = __importDefault(require("../config/firebaseAdmin"));
const notificationService_1 = require("../services/notificationService");
const userNotificationService_1 = require("../services/userNotificationService");
const supportRequestService_1 = require("../services/supportRequestService");
function toBoolean(value) {
    return value === 1 || value === '1' || value === true;
}
function toNullableNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function stringOrNull(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const asString = String(value).trim();
    return asString.length > 0 ? asString : null;
}
function mapFavorite(row) {
    const images = row.images ? row.images.split(',').filter(Boolean) : [];
    const agency = row.agency_id
        ? {
            id: Number(row.agency_id),
            name: row.agency_name,
            logo_url: row.agency_logo_url,
            address: row.agency_address,
            city: row.agency_city,
            state: row.agency_state,
            phone: row.agency_phone,
        }
        : null;
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        purpose: row.purpose,
        status: row.status,
        price: Number(row.price),
        price_sale: row.price_sale != null ? Number(row.price_sale) : null,
        price_rent: row.price_rent != null ? Number(row.price_rent) : null,
        code: row.code ?? null,
        address: row.address,
        quadra: row.quadra ?? null,
        lote: row.lote ?? null,
        numero: row.numero ?? null,
        bairro: row.bairro ?? null,
        complemento: row.complemento ?? null,
        tipo_lote: row.tipo_lote ?? null,
        city: row.city,
        state: row.state,
        bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
        bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
        area_construida: row.area_construida != null ? Number(row.area_construida) : null,
        area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
        garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
        has_wifi: toBoolean(row.has_wifi),
        tem_piscina: toBoolean(row.tem_piscina),
        tem_energia_solar: toBoolean(row.tem_energia_solar),
        tem_automacao: toBoolean(row.tem_automacao),
        tem_ar_condicionado: toBoolean(row.tem_ar_condicionado),
        eh_mobiliada: toBoolean(row.eh_mobiliada),
        valor_condominio: toNullableNumber(row.valor_condominio),
        valor_iptu: toNullableNumber(row.valor_iptu),
        video_url: row.video_url ?? null,
        images,
        agency,
        broker_name: row.broker_name ?? null,
        broker_phone: row.broker_phone ?? null,
        broker_email: row.broker_email ?? null,
        favorited_at: row.favorited_at ?? null,
    };
}
class UserController {
    async register(req, res) {
        const { name, email, password, phone, address, city, state } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
        }
        try {
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUserRows.length > 0) {
                return res.status(409).json({ error: 'Este email já está em uso.' });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            await connection_1.default.query(`
          INSERT INTO users (name, email, password_hash, phone, address, city, state)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [name, email, passwordHash, stringOrNull(phone), stringOrNull(address), stringOrNull(city), stringOrNull(state)]);
            return res.status(201).json({ message: 'Usuário criado com sucesso!' });
        }
        catch (error) {
            console.error('Erro no registro do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async login(req, res) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
        }
        try {
            const [rows] = await connection_1.default.query('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
            if (rows.length === 0) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const user = rows[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, String(user.password_hash));
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: 'user' }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '1d' });
            delete user.password_hash;
            return res.status(200).json({ user, token });
        }
        catch (error) {
            console.error('Erro no login do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getProfile(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        try {
            const [userRows] = await connection_1.default.query('SELECT id, name, email, phone, address, city, state FROM users WHERE id = ?', [userId]);
            if (userRows.length === 0) {
                return res.status(404).json({ error: 'Usuário não encontrado.' });
            }
            const user = userRows[0];
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [userId]);
            if (brokerRows.length > 0 && ['approved', 'pending_verification'].includes(String(brokerRows[0].status))) {
                return res.json({
                    role: 'broker',
                    status: brokerRows[0].status,
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        phone: user.phone,
                        address: user.address,
                        city: user.city,
                        state: user.state,
                    },
                });
            }
            return res.json({
                role: 'client',
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    address: user.address,
                    city: user.city,
                    state: user.state,
                },
            });
        }
        catch (error) {
            console.error('Erro ao buscar perfil:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async updateProfile(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        const { phone, address, city, state } = req.body ?? {};
        try {
            await connection_1.default.query('UPDATE users SET phone = ?, address = ?, city = ?, state = ? WHERE id = ?', [stringOrNull(phone), stringOrNull(address), stringOrNull(city), stringOrNull(state), userId]);
            const [userRows] = await connection_1.default.query('SELECT id, name, email, phone, address, city, state FROM users WHERE id = ?', [userId]);
            const user = userRows[0];
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [userId]);
            const brokerStatus = brokerRows.length > 0 ? String(brokerRows[0].status) : '';
            const isBroker = ['approved', 'pending_verification'].includes(brokerStatus);
            const role = isBroker ? 'broker' : 'client';
            const status = isBroker ? brokerStatus : undefined;
            return res.json({
                role,
                status,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    address: user.address,
                    city: user.city,
                    state: user.state,
                },
            });
        }
        catch (error) {
            console.error('Erro ao atualizar perfil:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async syncUser(req, res) {
        try {
            const secret = req.headers['x-sync-secret'];
            if (secret !== process.env.SYNC_SECRET_KEY) {
                return res.status(401).json({ error: 'Acesso não autorizado.' });
            }
            const { uid, email } = req.body;
            if (!uid || !email) {
                return res.status(400).json({ error: 'UID e email são obrigatórios.' });
            }
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE firebase_uid = ? OR email = ?', [uid, email]);
            if (existingUserRows.length > 0) {
                return res.status(409).json({ error: 'Usuário já existe.' });
            }
            await connection_1.default.query('INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)', [uid, email, `User-${uid.substring(0, 8)}`]);
            return res.status(201).json({ message: 'Usuário sincronizado com sucesso!' });
        }
        catch (error) {
            console.error('Erro na sincronizacao do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async googleLogin(req, res) {
        const { idToken, profileType } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'Token do Google é obrigatório.' });
        }
        try {
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(idToken);
            const { uid, email, name } = decodedToken;
            const requestedRole = profileType === 'broker' ? 'broker' : profileType === 'client' ? 'client' : 'auto';
            const autoMode = requestedRole === 'auto';
            const [userRows] = await connection_1.default.query(`
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 u.phone, u.address, u.city, u.state,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `, [uid, email]);
            let user;
            let isNewUser = false;
            if (userRows.length > 0) {
                user = userRows[0];
                if (!user.firebase_uid) {
                    await connection_1.default.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, user.id]);
                }
                const empty = (v) => v === null || v === undefined || String(v).trim() === '';
                const missingProfile = (empty(user.phone) || empty(user.city) || empty(user.state) || empty(user.address)) &&
                    user.broker_status == null;
                const missingRole = !user.role;
                if (autoMode && (missingProfile || missingRole)) {
                    return res.json({
                        requiresProfileChoice: true,
                        isNewUser: false,
                        roleLocked: false,
                        pending: { email, name },
                    });
                }
            }
            else {
                if (autoMode) {
                    return res.json({
                        requiresProfileChoice: true,
                        isNewUser: true,
                        roleLocked: false,
                        pending: { email, name },
                    });
                }
                const chosenRole = requestedRole === 'broker' ? 'broker' : 'client';
                const [result] = await connection_1.default.query('INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)', [uid, email, name || `User-${uid.substring(0, 8)}`, chosenRole]);
                user = {
                    id: result.insertId,
                    name: name || `User-${uid.substring(0, 8)}`,
                    email,
                    role: chosenRole,
                };
                isNewUser = true;
                user.broker_status = null;
                if (chosenRole === 'broker') {
                    await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [user.id, null, 'pending_verification']);
                    user.broker_status = 'pending_verification';
                }
            }
            // Papel efetivo:
            // - Se solicitou broker explicitamente, promove/atualiza para broker.
            // - Se solicitou client explicitamente e não tinha role, fixa como client.
            // - Modo auto mantém papel existente.
            let effectiveRole = user.role ?? 'client';
            let roleLocked = true;
            if (!autoMode && requestedRole === 'broker') {
                effectiveRole = 'broker';
                roleLocked = false;
                await connection_1.default.query('UPDATE users SET role = ? WHERE id = ?', [effectiveRole, user.id]);
                const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [user.id]);
                if (brokerRows.length === 0) {
                    await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [user.id, null, 'pending_verification']);
                    user.broker_status = 'pending_verification';
                }
                else {
                    user.broker_status = brokerRows[0].status;
                }
            }
            else if (!autoMode && requestedRole === 'client' && !user.role) {
                effectiveRole = 'client';
                roleLocked = false;
                await connection_1.default.query('UPDATE users SET role = ? WHERE id = ?', [effectiveRole, user.id]);
            }
            // Se papel final é corretor, garanta status carregado
            if (effectiveRole === 'broker') {
                const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [user.id]);
                if (brokerRows.length > 0) {
                    user.broker_status = brokerRows[0].status;
                }
                else {
                    user.broker_status = 'pending_verification';
                }
            }
            const needsCompletion = !user.phone || !user.city || !user.state || !user.address;
            const requiresDocuments = effectiveRole === 'broker' &&
                (!user.broker_status || user.broker_status !== 'approved');
            // No modo auto, se a conta for nova ou estiver incompleta/pedindo docs, devolve escolha antes de emitir token
            if (autoMode && (isNewUser || needsCompletion || requiresDocuments)) {
                return res.json({
                    requiresProfileChoice: true,
                    isNewUser,
                    roleLocked,
                    needsCompletion,
                    requiresDocuments,
                    pending: { email, name },
                });
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: effectiveRole }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '7d' });
            return res.json({
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: effectiveRole,
                    phone: user.phone ?? null,
                    address: user.address ?? null,
                    city: user.city ?? null,
                    state: user.state ?? null,
                    broker_status: user.broker_status,
                },
                token,
                needsCompletion,
                requiresDocuments,
                isNewUser,
                roleLocked,
            });
        }
        catch (error) {
            console.error('Erro no login com Google:', error);
            return res.status(401).json({ error: 'Token do Google inválido.' });
        }
    }
    async firebaseLogin(req, res) {
        const { idToken, role, name: nameOverride, phone: phoneOverride, address, city, state } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'Token do Firebase é obrigatório.' });
        }
        try {
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(idToken);
            const { uid, email, name, phone_number: phone } = decodedToken;
            const fallbackEmail = email ?? `${uid}@noemail.firebase`;
            const displayName = name || `User-${uid.substring(0, 8)}`;
            const [userRows] = await connection_1.default.query(`
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 u.phone,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `, [uid, fallbackEmail]);
            let user;
            if (userRows.length > 0) {
                user = userRows[0];
                const updates = [];
                if (!user.firebase_uid)
                    updates.push(['firebase_uid', uid]);
                if ((phone || phoneOverride) && user.phone !== (phoneOverride ?? phone)) {
                    updates.push(['phone', phoneOverride ?? phone]);
                }
                if (email && user.email !== email)
                    updates.push(['email', email]);
                if (nameOverride && user.name !== nameOverride)
                    updates.push(['name', nameOverride]);
                if (address !== undefined)
                    updates.push(['address', address]);
                if (city !== undefined)
                    updates.push(['city', city]);
                if (state !== undefined)
                    updates.push(['state', state]);
                if (updates.length > 0) {
                    const set = updates.map(([field]) => `${field} = ?`).join(', ');
                    const values = updates.map(([, value]) => value);
                    await connection_1.default.query(`UPDATE users SET ${set} WHERE id = ?`, [...values, user.id]);
                }
            }
            else {
                const [result] = await connection_1.default.query('INSERT INTO users (firebase_uid, email, name, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)', [uid, fallbackEmail, nameOverride ?? displayName, phoneOverride ?? phone ?? null, address ?? null, city ?? null, state ?? null]);
                user = {
                    id: result.insertId,
                    name: nameOverride ?? displayName,
                    email: fallbackEmail,
                    role: 'client',
                };
            }
            const effectiveRole = role ?? user.role ?? 'client';
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: effectiveRole }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '7d' });
            return res.json({
                user: {
                    id: user.id,
                    name: user.name ?? nameOverride ?? displayName,
                    email: user.email ?? fallbackEmail,
                    role: effectiveRole,
                    phone: user.phone ?? phoneOverride ?? phone ?? null,
                    address: user.address ?? address ?? null,
                    city: user.city ?? city ?? null,
                    state: user.state ?? state ?? null,
                    broker_status: user.broker_status,
                },
                token,
            });
        }
        catch (error) {
            console.error('Erro no login com Firebase:', error);
            return res.status(401).json({ error: 'Token do Firebase inválido.' });
        }
    }
    async addFavorite(req, res) {
        const userId = req.userId;
        const propertyId = Number(req.params.propertyId);
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
        }
        try {
            const [propertyRows] = await connection_1.default.query('SELECT id FROM properties WHERE id = ?', [propertyId]);
            if (propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imóvel não encontrado.' });
            }
            const [favoriteRows] = await connection_1.default.query('SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?', [userId, propertyId]);
            if (favoriteRows.length > 0) {
                return res.status(409).json({ error: 'Este imóvel ja esta nos seus favoritos.' });
            }
            await connection_1.default.query('INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)', [userId, propertyId]);
            return res.status(201).json({ message: 'Imóvel adicionado aos favoritos.' });
        }
        catch (error) {
            console.error('Erro ao adicionar favorito:', error);
            return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
        }
    }
    async removeFavorite(req, res) {
        const userId = req.userId;
        const propertyId = Number(req.params.propertyId);
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
        }
        try {
            const [result] = await connection_1.default.query('DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?', [userId, propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Favorito não encontrado.' });
            }
            return res.status(200).json({ message: 'Imóvel removido dos favoritos.' });
        }
        catch (error) {
            console.error('Erro ao remover favorito:', error);
            return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
        }
    }
    async listFavorites(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        try {
            const [rows] = await connection_1.default.query(`
          SELECT
            p.*,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
            ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
            ANY_VALUE(COALESCE(u.email, u_owner.email)) AS broker_email,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
            MAX(f.created_at) AS favorited_at
          FROM favoritos f
          JOIN properties p ON p.id = f.imovel_id
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE f.usuario_id = ?
          GROUP BY p.id
          ORDER BY favorited_at DESC
        `, [userId]);
            return res.status(200).json(rows.map(mapFavorite));
        }
        catch (error) {
            console.error('Erro ao listar favoritos:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getMyProperties(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        try {
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 10;
            const offset = (page - 1) * limit;
            const countQuery = 'SELECT COUNT(*) as total FROM properties WHERE owner_id = ?';
            const [totalResult] = await connection_1.default.query(countQuery, [userId]);
            const total = totalResult[0]?.total ?? 0;
            const dataQuery = `
        SELECT
          p.owner_id,
          p.broker_id,
          p.id,
          p.title,
          p.description,
          p.type,
          p.status,
          p.purpose,
          p.price,
          p.price_sale,
          p.price_rent,
          p.code,
          p.address,
          p.quadra,
          p.lote,
          p.numero,
          p.bairro,
          p.complemento,
          p.tipo_lote,
          p.city,
          p.state,
          p.bedrooms,
          p.bathrooms,
          p.area_construida,
          p.area_terreno,
          p.garage_spots,
          p.has_wifi,
          p.tem_piscina,
          p.tem_energia_solar,
          p.tem_automacao,
          p.tem_ar_condicionado,
          p.eh_mobiliada,
          p.valor_condominio,
          p.valor_iptu,
          p.video_url,
          p.created_at,
          u.name AS broker_name,
          u.phone AS broker_phone,
          u.email AS broker_email,
          GROUP_CONCAT(pi.image_url ORDER BY pi.id) AS images
        FROM properties p
        LEFT JOIN users u ON u.id = p.owner_id
        LEFT JOIN property_images pi ON p.id = pi.property_id
        WHERE p.owner_id = ?
        GROUP BY
          p.id, p.owner_id, p.broker_id, p.title, p.description, p.type, p.status, p.purpose,
          p.price, p.price_sale, p.price_rent, p.code, p.address, p.quadra, p.lote, p.numero,
          p.bairro, p.complemento, p.tipo_lote, p.city, p.state, p.bedrooms, p.bathrooms,
          p.area_construida, p.area_terreno, p.garage_spots, p.has_wifi, p.tem_piscina,
          p.tem_energia_solar, p.tem_automacao, p.tem_ar_condicionado, p.eh_mobiliada,
          p.valor_condominio, p.valor_iptu, p.video_url, p.created_at, u.name, u.phone, u.email
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `;
            const [dataRows] = await connection_1.default.query(dataQuery, [userId, limit, offset]);
            const parseBool = (value) => value === 1 || value === '1' || value === true;
            const properties = dataRows.map((row) => ({
                ...row,
                price: Number(row.price),
                price_sale: row.price_sale != null ? Number(row.price_sale) : null,
                price_rent: row.price_rent != null ? Number(row.price_rent) : null,
                bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
                bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
                area_construida: row.area_construida != null ? Number(row.area_construida) : null,
                area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
                garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
                has_wifi: parseBool(row.has_wifi),
                tem_piscina: parseBool(row.tem_piscina),
                tem_energia_solar: parseBool(row.tem_energia_solar),
                tem_automacao: parseBool(row.tem_automacao),
                tem_ar_condicionado: parseBool(row.tem_ar_condicionado),
                eh_mobiliada: parseBool(row.eh_mobiliada),
                valor_condominio: row.valor_condominio != null ? Number(row.valor_condominio) : null,
                valor_iptu: row.valor_iptu != null ? Number(row.valor_iptu) : null,
                images: row.images ? row.images.split(',') : [],
            }));
            return res.json({
                success: true,
                data: properties,
                total,
                page,
                totalPages: Math.ceil(total / limit),
            });
        }
        catch (error) {
            console.error('Erro ao buscar imoveis do usuario:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async requestSupport(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        try {
            const [lastRows] = await connection_1.default.query(`
          SELECT created_at
          FROM support_requests
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `, [userId]);
            const lastRequestAt = lastRows[0]?.created_at
                ? new Date(lastRows[0].created_at)
                : null;
            const cooldown = (0, supportRequestService_1.evaluateSupportRequestCooldown)(lastRequestAt);
            if (!cooldown.allowed) {
                return res.status(429).json({
                    error: 'Voce ja enviou uma solicitacao nas ultimas 24 horas. Aguarde para reenviar.',
                    retryAfterSeconds: cooldown.retryAfterSeconds,
                });
            }
            await connection_1.default.query('INSERT INTO support_requests (user_id) VALUES (?)', [userId]);
            const [rows] = await connection_1.default.query('SELECT name, email FROM users WHERE id = ?', [userId]);
            const name = rows[0]?.name ? String(rows[0].name) : 'Usuario';
            const email = rows[0]?.email ? String(rows[0].email) : '';
            const label = email ? `${name} (${email})` : name;
            await (0, notificationService_1.notifyAdmins)(`Solicitacao de anuncio recebida de ${label}.`, 'announcement', Number(userId));
            return res.status(201).json({ message: 'Solicitacao enviada.' });
        }
        catch (error) {
            console.error('Erro ao enviar solicitacao:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async listNotifications(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        try {
            const role = await (0, userNotificationService_1.resolveUserNotificationRole)(Number(userId));
            const sql = `
        SELECT n.id,
               n.message,
               n.related_entity_type,
               n.related_entity_id,
               n.recipient_id,
               n.is_read,
               n.created_at
        FROM notifications n
        INNER JOIN (
          SELECT MAX(id) AS max_id
          FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'user'
            AND recipient_role = ?
            AND recipient_id NOT IN (SELECT id FROM admins)
          GROUP BY message,
                   related_entity_type,
                   COALESCE(related_entity_id, 0),
                   recipient_id
        ) latest ON latest.max_id = n.id
        ORDER BY n.created_at DESC
      `;
            const [rows] = await connection_1.default.query(sql, [userId, role]);
            return res.status(200).json(rows);
        }
        catch (error) {
            console.error('Erro ao buscar notificacoes:', error);
            return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
        }
    }
    async markNotificationRead(req, res) {
        const userId = req.userId;
        const notificationId = Number(req.params.id);
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        if (Number.isNaN(notificationId)) {
            return res.status(400).json({ error: 'Identificador de notificação inválido.' });
        }
        try {
            const role = await (0, userNotificationService_1.resolveUserNotificationRole)(Number(userId));
            const [result] = await connection_1.default.query(`
          DELETE FROM notifications
          WHERE id = ?
            AND recipient_id = ?
            AND recipient_type = 'user'
            AND recipient_role = ?
            AND recipient_id NOT IN (SELECT id FROM admins)
        `, [notificationId, userId, role]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Notificação não encontrada.' });
            }
            return res.status(204).send();
        }
        catch (error) {
            console.error('Erro ao remover notificação:', error);
            return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
        }
    }
    async markAllNotificationsRead(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        try {
            const role = await (0, userNotificationService_1.resolveUserNotificationRole)(Number(userId));
            await connection_1.default.query(`
          DELETE FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'user'
            AND recipient_role = ?
            AND recipient_id NOT IN (SELECT id FROM admins)
        `, [userId, role]);
            return res.status(204).send();
        }
        catch (error) {
            console.error('Erro ao limpar notificações:', error);
            return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
        }
    }
    async registerDeviceToken(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        const { token, platform } = req.body ?? {};
        const trimmedToken = typeof token === 'string' ? token.trim() : '';
        const trimmedPlatform = typeof platform === 'string' ? platform.trim() : null;
        if (!trimmedToken) {
            return res.status(400).json({ error: 'Token do dispositivo e obrigatorio.' });
        }
        try {
            await connection_1.default.query(`
          INSERT INTO user_device_tokens (user_id, fcm_token, platform)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            platform = VALUES(platform),
            updated_at = CURRENT_TIMESTAMP
        `, [userId, trimmedToken, trimmedPlatform]);
            return res.status(204).send();
        }
        catch (error) {
            console.error('Erro ao registrar token do dispositivo:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async unregisterDeviceToken(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }
        const tokenFromQuery = typeof req.query.token === 'string' ? req.query.token : null;
        const tokenFromBody = typeof req.body?.token === 'string' ? req.body.token : null;
        const trimmedToken = (tokenFromBody ?? tokenFromQuery ?? '').trim();
        if (!trimmedToken) {
            return res.status(400).json({ error: 'Token do dispositivo e obrigatorio.' });
        }
        try {
            await connection_1.default.query('DELETE FROM user_device_tokens WHERE user_id = ? AND fcm_token = ?', [userId, trimmedToken]);
            return res.status(204).send();
        }
        catch (error) {
            console.error('Erro ao remover token do dispositivo:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
}
exports.userController = new UserController();
