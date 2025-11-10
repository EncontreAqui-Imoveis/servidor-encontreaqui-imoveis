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
        favorited_at: row.favorited_at ?? null,
    };
}
class UserController {
    async register(req, res) {
        const { name, email, password, phone, address, city, state } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nome, email e senha sao obrigatorios.' });
        }
        try {
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE email = ?', [email]);
            if (existingUserRows.length > 0) {
                return res.status(409).json({ error: 'Este email ja esta em uso.' });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            await connection_1.default.query(`
          INSERT INTO users (name, email, password_hash, phone, address, city, state, role)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'client')
        `, [name, email, passwordHash, stringOrNull(phone), stringOrNull(address), stringOrNull(city), stringOrNull(state)]);
            return res.status(201).json({ message: 'Usuario criado com sucesso!' });
        }
        catch (error) {
            console.error('Erro no registro do usuario:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async login(req, res) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
        }
        try {
            const [rows] = await connection_1.default.query('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
            if (rows.length === 0) {
                return res.status(401).json({ error: 'Credenciais invalidas.' });
            }
            const user = rows[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, String(user.password_hash));
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: 'Credenciais invalidas.' });
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
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        try {
            const [userRows] = await connection_1.default.query('SELECT id, name, email FROM users WHERE id = ?', [userId]);
            if (userRows.length === 0) {
                return res.status(404).json({ error: 'Usuário nao encontrado.' });
            }
            const user = userRows[0];
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [userId]);
            if (brokerRows.length > 0) {
                return res.json({
                    role: 'broker',
                    status: brokerRows[0].status,
                    user: { id: user.id, name: user.name, email: user.email },
                });
            }
            return res.json({
                role: 'client',
                user: { id: user.id, name: user.name, email: user.email },
            });
        }
        catch (error) {
            console.error('Erro ao buscar perfil:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async syncUser(req, res) {
        try {
            const secret = req.headers['x-sync-secret'];
            if (secret !== process.env.SYNC_SECRET_KEY) {
                return res.status(401).json({ error: 'Acesso nao autorizado.' });
            }
            const { uid, email } = req.body;
            if (!uid || !email) {
                return res.status(400).json({ error: 'UID e email sao obrigatorios.' });
            }
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE firebase_uid = ? OR email = ?', [uid, email]);
            if (existingUserRows.length > 0) {
                return res.status(409).json({ error: 'Usuario ja existe.' });
            }
            await connection_1.default.query('INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)', [uid, email, `User-${uid.substring(0, 8)}`, 'client']);
            return res.status(201).json({ message: 'Usuario sincronizado com sucesso!' });
        }
        catch (error) {
            console.error('Erro na sincronizacao do usuario:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async googleLogin(req, res) {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'Token do Google e obrigatorio.' });
        }
        try {
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(idToken);
            const { uid, email, name } = decodedToken;
            const [userRows] = await connection_1.default.query(`
          SELECT u.id, u.name, u.email, u.firebase_uid,
                 CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END AS role,
                 b.status AS broker_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.firebase_uid = ? OR u.email = ?
        `, [uid, email]);
            let user;
            if (userRows.length > 0) {
                user = userRows[0];
                if (!user.firebase_uid) {
                    await connection_1.default.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, user.id]);
                }
            }
            else {
                const [result] = await connection_1.default.query('INSERT INTO users (firebase_uid, email, name, role) VALUES (?, ?, ?, ?)', [uid, email, name || `User-${uid.substring(0, 8)}`, 'client']);
                user = {
                    id: result.insertId,
                    name: name || `User-${uid.substring(0, 8)}`,
                    email,
                    role: 'client',
                };
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '1d' });
            return res.json({
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                },
                token,
            });
        }
        catch (error) {
            console.error('Erro no login com Google:', error);
            return res.status(401).json({ error: 'Token do Google invalido.' });
        }
    }
    async addFavorite(req, res) {
        const userId = req.userId;
        const propertyId = Number(req.params.propertyId);
        if (!userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        try {
            const [propertyRows] = await connection_1.default.query('SELECT id FROM properties WHERE id = ?', [propertyId]);
            if (propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            const [favoriteRows] = await connection_1.default.query('SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?', [userId, propertyId]);
            if (favoriteRows.length > 0) {
                return res.status(409).json({ error: 'Este imovel ja esta nos seus favoritos.' });
            }
            await connection_1.default.query('INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)', [userId, propertyId]);
            return res.status(201).json({ message: 'Imovel adicionado aos favoritos.' });
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
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        try {
            const [result] = await connection_1.default.query('DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?', [userId, propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Favorito nao encontrado.' });
            }
            return res.status(200).json({ message: 'Imovel removido dos favoritos.' });
        }
        catch (error) {
            console.error('Erro ao remover favorito:', error);
            return res.status(500).json({ error: 'Ocorreu um erro no servidor.' });
        }
    }
    async listFavorites(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
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
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
            MAX(f.created_at) AS favorited_at
          FROM favoritos f
          JOIN properties p ON p.id = f.imovel_id
          LEFT JOIN brokers b ON p.broker_id = b.id
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
    async listNotifications(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: 'Usuario nao autenticado.' });
        }
        try {
            const sql = `
        SELECT id, message, related_entity_type, related_entity_id, created_at
        FROM notifications
        WHERE recipient_id = ?
          OR (recipient_id IS NULL AND related_entity_type = 'other')
        ORDER BY created_at DESC
      `;
            const [rows] = await connection_1.default.query(sql, [userId]);
            return res.status(200).json(rows);
        }
        catch (error) {
            console.error('Erro ao buscar notificacoes:', error);
            return res.status(500).json({ error: 'Ocorreu um erro interno no servidor.' });
        }
    }
}
exports.userController = new UserController();
