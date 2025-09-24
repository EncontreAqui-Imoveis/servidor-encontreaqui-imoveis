import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import connection from '../database/connection';
import AuthRequest from '../middlewares/auth';
import admin from '../config/firebaseAdmin';

class UserController {
    async register(req: Request, res: Response) {
        const { name, email, password, phone, address, city, state } = req.body;
        
        if (!name || !email) {
            return res.status(400).json({ error: 'Nome e email são obrigatórios.' });
        }
        try {
            const [existingUserRows] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
            const existingUsers = existingUserRows as any[];
            
            if (existingUsers.length > 0) {
                return res.status(400).json({ error: 'Este e-mail já está em uso.' });
            }
            
            const password_hash = await bcrypt.hash(password, 8);
            const insertQuery = `
                INSERT INTO users (name, email, password_hash, phone, address, city, state)
                VALUES (?, ?, ?, ?, ?, ?, ?);
            `;
            await connection.query(insertQuery, [name, email, password_hash, phone, address, city, state]);
            return res.status(201).json({ message: 'Usuário criado com sucesso!' });
        } catch (error) {
            console.error('Erro no registro do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async login(req: Request, res: Response) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
        }
        try {
            const [rows] = await connection.query('SELECT id, name, email, password_hash FROM users WHERE email = ?', [email]);
            const users = rows as any[];
            
            if (users.length === 0) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            
            const user = users[0];
            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
            
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            
            const token = jwt.sign(
                { id: user.id, role: 'user' },
                process.env.JWT_SECRET || 'default_secret',
                { expiresIn: '1d' }
            );
            
            delete user.password_hash;
            return res.status(200).json({ user, token });
        } catch (error) {
            console.error('Erro no login do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async getProfile(req: AuthRequest, res: Response) {
        const userId = req.userId;

        if (!userId) {
            return res.status(401).json({ error: 'Usuário não autenticado.' });
        }

        try {
            const [userRows] = await connection.query(
                'SELECT id, name, email FROM users WHERE id = ?', 
                [userId]
            );
            
            const users = userRows as any[];
            if (users.length === 0) {
                return res.status(404).json({ error: 'Usuário não encontrado.' });
            }

            const user = users[0];

            const [brokerRows] = await connection.query(
                'SELECT status FROM brokers WHERE id = ?',
                [user.id]
            );
            
            const brokers = brokerRows as any[];

            if (brokers.length > 0) {
                return res.json({ 
                    role: 'broker', 
                    status: brokers[0].status,
                    user: { id: user.id, name: user.name, email: user.email }
                });
            } else {
                return res.json({ 
                    role: 'client',
                    user: { id: user.id, name: user.name, email: user.email }
                });
            }
        } catch (error) {
            console.error('Erro ao buscar perfil:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async syncUser(req: Request, res: Response) {
        try {
            const secret = req.headers['x-sync-secret'];
            if (secret !== process.env.SYNC_SECRET_KEY) {
                return res.status(401).json({ error: 'Acesso não autorizado.' });
            }

            const { uid, email } = req.body as { uid: string; email: string };

            if (!uid || !email) {
                return res.status(400).json({ error: 'UID e email são obrigatórios.' });
            }

            const [existingUserRows] = await connection.query(
                'SELECT id FROM users WHERE firebase_uid = ? OR email = ?',
                [uid, email]
            );

            const existingUsers = existingUserRows as any[];
            if (existingUsers.length > 0) {
                return res.status(409).json({ error: 'Usuário já existe.' });
            }

            await connection.query(
                'INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)',
                [uid, email, `User-${uid.substring(0, 8)}`]
            );

            return res.status(201).json({ message: 'Usuário sincronizado com sucesso!' });
        } catch (error) {
            console.error('Erro na sincronização do usuário:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async googleLogin(req: Request, res: Response) {
        const { idToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ error: 'Token do Google é obrigatório.' });
        }

        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            const { uid, email, name } = decodedToken;

            const [userRows] = await connection.query(
                `SELECT u.id, u.name, u.email, u.firebase_uid, 
                        CASE WHEN b.id IS NOT NULL THEN 'broker' ELSE 'client' END as role,
                        b.status as broker_status
                 FROM users u
                 LEFT JOIN brokers b ON u.id = b.id
                 WHERE u.firebase_uid = ? OR u.email = ?`,
                [uid, email]
            );
            
            const users = userRows as any[];
            let user;

            if (users.length > 0) {
                user = users[0];
                if (!user.firebase_uid) {
                    await connection.query(
                        'UPDATE users SET firebase_uid = ? WHERE id = ?',
                        [uid, user.id]
                    );
                }
            } else {
                const [result] = await connection.query(
                    'INSERT INTO users (firebase_uid, email, name) VALUES (?, ?, ?)',
                    [uid, email, name || `User-${uid.substring(0, 8)}`]
                );
                user = {
                    id: (result as any).insertId,
                    name: name || `User-${uid.substring(0, 8)}`,
                    email,
                    role: 'client'
                };
            }

            const token = jwt.sign(
                { id: user.id, role: user.role },
                process.env.JWT_SECRET || 'default_secret',
                { expiresIn: '1d' }
            );

            return res.json({ 
                user: { 
                    id: user.id, 
                    name: user.name, 
                    email: user.email,
                    role: user.role 
                }, 
                token 
            });
        } catch (error) {
            console.error('Erro no login com Google:', error);
            return res.status(401).json({ error: 'Token do Google inválido.' });
        }
    }
}

export const userController = new UserController();