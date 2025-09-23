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
class UserController {
    async register(req, res) {
        const { name, email, password, phone, address, city, state } = req.body;
        if (!name || !email) {
            return res.status(400).json({ error: 'Nome e email são obrigatórios.' });
        }
        try {
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE email = ?', [email]);
            const existingUsers = existingUserRows;
            if (existingUsers.length > 0) {
                return res.status(400).json({ error: 'Este e-mail já está em uso.' });
            }
            const password_hash = await bcryptjs_1.default.hash(password, 8);
            const insertQuery = `
        INSERT INTO users (name, email, password_hash, phone, address, city, state)
        VALUES (?, ?, ?, ?, ?, ?, ?);
      `;
            await connection_1.default.query(insertQuery, [name, email, password_hash, phone, address, city, state]);
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
            const users = rows;
            if (users.length === 0) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const user = users[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, user.password_hash);
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
            // Buscar o usuário pelo ID
            const [userRows] = await connection_1.default.query('SELECT id, name, email FROM users WHERE id = ?', [userId]);
            const users = userRows;
            if (users.length === 0) {
                return res.status(404).json({ error: 'Usuário não encontrado.' });
            }
            const user = users[0];
            // Verificar se é corretor (usando ID direto) 👈 CORREÇÃO AQUI
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', // 👈 'id' em vez de 'user_id'
            [user.id]);
            const brokers = brokerRows;
            if (brokers.length > 0) {
                return res.json({
                    role: 'broker',
                    status: brokers[0].status,
                    user: { id: user.id, name: user.name, email: user.email }
                });
            }
            else {
                return res.json({
                    role: 'client',
                    user: { id: user.id, name: user.name, email: user.email }
                });
            }
        }
        catch (error) {
            console.error('Erro ao buscar perfil:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async syncUser(req, res) {
        try {
            // Verificar chave secreta
            const secret = req.headers['x-sync-secret'];
            if (secret !== process.env.SYNC_SECRET_KEY) {
                return res.status(401).json({ error: 'Acesso não autorizado.' });
            }
            const { uid, email } = req.body;
            if (!uid || !email) {
                return res.status(400).json({ error: 'UID e email são obrigatórios.' });
            }
            // Verificar se usuário já existe
            const [existingUserRows] = await connection_1.default.query('SELECT id FROM users WHERE firebase_uid = ? OR email = ?', [uid, email]);
            const existingUsers = existingUserRows;
            if (existingUsers.length > 0) {
                return res.status(409).json({ error: 'Usuário já existe.' });
            }
            // Inserir novo usuário
            await connection_1.default.query('INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)', [uid, email, `User-${uid.substring(0, 8)}`]);
            return res.status(201).json({ message: 'Usuário sincronizado com sucesso!' });
        }
        catch (error) {
            console.error('Erro na sincronização do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async googleLogin(req, res) {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ error: 'Token do Google é obrigatório.' });
        }
        try {
            // Verificar o token do Google
            const decodedToken = await firebaseAdmin_1.default.auth().verifyIdToken(idToken);
            const { uid, email, name } = decodedToken;
            // Verificar se o usuário já existe
            const [userRows] = await connection_1.default.query('SELECT id, name, email FROM users WHERE firebase_uid = ? OR email = ?', [uid, email]);
            const users = userRows;
            let user;
            let role = 'client'; // Default role
            if (users.length > 0) {
                // Usuário existe, atualizar firebase_uid se necessário
                user = users[0];
                if (!user.firebase_uid) {
                    await connection_1.default.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, user.id]);
                }
                // Verificar se é corretor
                const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE user_id = ?', [user.id]);
                const brokers = brokerRows;
                if (brokers.length > 0) {
                    role = 'broker';
                }
            }
            else {
                const [result] = await connection_1.default.query('INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)', [uid, email, name || `User-${uid.substring(0, 8)}`]);
                user = {
                    id: result.insertId,
                    name: name || `User-${uid.substring(0, 8)}`,
                    email
                };
                // Novo usuário é cliente por padrão
                role = 'client';
            }
            // Gerar JWT com a role correta
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: role }, // Inclui a role no token
            process.env.JWT_SECRET || 'default_secret', { expiresIn: '1d' });
            return res.json({
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: role
                },
                token
            });
        }
        catch (error) {
            console.error('Erro no login com Google:', error);
            return res.status(401).json({ error: 'Token do Google inválido.' });
        }
    }
}
exports.userController = new UserController();
