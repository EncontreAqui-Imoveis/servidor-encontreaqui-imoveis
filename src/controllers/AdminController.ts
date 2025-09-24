import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import connection from '../database/connection';

class AdminController {
    async login(req: Request, res: Response) {
    const { email, password } = req.body;
    console.log('Login attempt for email:', email);
    if (!email || !password) {
        console.log('Email or password missing');
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
        const [rows] = await connection.query('SELECT * FROM admins WHERE email = ?', [email]);
        const admins = rows as any[];
        console.log('Number of admins found:', admins.length);

        if (admins.length === 0) {
            console.log('No admin found with email:', email);
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const admin = admins[0];
        console.log('Admin found:', admin.id, admin.email);

        const isPasswordCorrect = await bcrypt.compare(password, admin.password_hash);
        console.log('Password correct:', isPasswordCorrect);

        if (!isPasswordCorrect) {
            console.log('Password incorrect for admin:', admin.id);
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const jwtSecret = process.env.JWT_SECRET || 'default_secret';
        console.log('JWT Secret length:', jwtSecret.length);

        const token = jwt.sign(
            { id: admin.id, role: 'admin' },
            jwtSecret,
            { expiresIn: '1d' }
        );

        console.log('Token generated successfully for admin:', admin.id);

        delete admin.password_hash;
        return res.status(200).json({ admin, token });

    } catch (error) {
        console.error('Erro no login do admin:', error);
        return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
}

    async listPropertiesWithBrokers(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const searchTerm = req.query.search as string || '';
            const searchColumn = req.query.searchColumn as string || 'p.title';
            const status = req.query.status as string;
            const sortBy = req.query.sortBy as string || 'p.id';
            const sortOrder = req.query.sortOrder as string || 'desc';
            const offset = (page - 1) * limit;

            const whereClauses: string[] = [];
            const queryParams: (string | number)[] = [];

            const allowedSearchColumns = ['p.id', 'p.title', 'p.type', 'p.city', 'p.code'];
            const allowedSortColumns = ['p.id', 'p.title', 'p.type', 'p.city', 'u.name', 'p.price', 'p.code'];
            
            const safeSearchColumn = allowedSearchColumns.includes(searchColumn) ? searchColumn : 'p.title';
            const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'p.id';
            const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            if (searchTerm) {
                whereClauses.push(`${safeSearchColumn} LIKE ?`);
                queryParams.push(`%${searchTerm}%`);
            }

            if (status) {
                whereClauses.push('p.status = ?');
                queryParams.push(status);
            }

            const whereStatement = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

            const countQuery = `SELECT COUNT(*) as total FROM properties p ${whereStatement}`;
            const [totalResult] = await connection.query(countQuery, queryParams);
            const total = (totalResult as any[])[0].total;

            const dataQuery = `
                SELECT
                    p.id, p.code, p.title, p.type, p.status, p.price, p.city, p.broker_id,
                    p.sale_value, p.commission_rate, p.commission_value,
                    u.name as broker_name
                FROM
                    properties p
                LEFT JOIN
                    brokers b ON p.broker_id = b.id
                LEFT JOIN
                    users u ON b.id = u.id
                ${whereStatement}
                ORDER BY ${safeSortBy} ${safeSortOrder}
                LIMIT ? OFFSET ?
            `;

            const [data] = await connection.query(dataQuery, [...queryParams, limit, offset]);
            return res.json({ data, total });
        } catch (error) {
            console.error(`Erro ao buscar imóveis com corretores:`, error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async updateProperty(req: Request, res: Response) {
        const { id } = req.params;
        const data = req.body;

        try {
            if (data.status === 'Vendido') {
                if (data.sale_value != null && data.commission_rate != null) {
                    const saleValue = parseFloat(data.sale_value);
                    const commissionRate = parseFloat(data.commission_rate);
                    data.commission_value = saleValue * (commissionRate / 100);
                }
            } else {
                data.sale_value = null;
                data.commission_value = null;
                data.commission_rate = null;
            }

            if (data.id) delete data.id;
            if (data.broker_name) delete data.broker_name;

            const fields = Object.keys(data);
            const values = Object.values(data);

            if (fields.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado fornecido para atualização.' });
            }

            const setClause = fields.map(field => `\`${field}\` = ?`).join(', ');

            const updateQuery = `UPDATE properties SET ${setClause} WHERE id = ?`;
            
            await connection.query(updateQuery, [...values, id]);
            
            return res.status(200).json({ message: 'Imóvel atualizado com sucesso!' });

        } catch (error: any) { 
            console.error('ERRO DETALHADO AO ATUALIZAR IMÓVEL:', error);

            if (error.sqlMessage) {
                return res.status(500).json({ error: 'Erro na base de dados.', details: error.sqlMessage });
            }

            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async getAllBrokers(req: Request, res: Response) {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;
        const sortBy = req.query.sortBy as string || 'b.id';
        const sortOrder = req.query.sortOrder as string || 'desc';
    
        const allowedSortColumns = ['b.id', 'u.name', 'u.email', 'b.creci', 'property_count'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'b.id';
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
        try {
            const countQuery = `SELECT COUNT(*) as total FROM brokers`;
            const [totalResult] = await connection.query(countQuery);
            const total = (totalResult as any[])[0].total;
    
            const dataQuery = `
                SELECT
                    b.id, u.name, u.email, b.creci, b.created_at,
                    COUNT(p.id) AS property_count
                FROM
                    brokers b
                JOIN users u ON b.id = u.id
                LEFT JOIN
                    properties p ON b.id = p.broker_id
                GROUP BY
                    b.id, u.name, u.email, b.creci, b.created_at
                ORDER BY
                    ${safeSortBy} ${safeSortOrder}
                LIMIT ? OFFSET ?
            `;
            const [data] = await connection.query(dataQuery, [limit, offset]);
            return res.json({ data, total });
        } catch (error) {
            console.error(`Erro ao buscar corretores:`, error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async getAllUsers(req: Request, res: Response) {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;
        const sortBy = req.query.sortBy as string || 'id';
        const sortOrder = req.query.sortOrder as string || 'desc';

        const allowedSortColumns = ['id', 'name', 'email', 'phone'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        try {
            const countQuery = 'SELECT COUNT(*) as total FROM users';
            const [totalResult] = await connection.query(countQuery);
            const total = (totalResult as any[])[0].total;
            
            const dataQuery = `
                SELECT id, name, email, phone, created_at FROM users
                ORDER BY ${safeSortBy} ${safeSortOrder}
                LIMIT ? OFFSET ?
            `;
            const [data] = await connection.query(dataQuery, [limit, offset]);
            return res.json({ data, total });
        } catch (error) {
            console.error(`Erro ao buscar usuários:`, error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async deleteUser(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await connection.query('DELETE FROM users WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Utilizador deletado com sucesso.' });
        } catch (error) {
            console.error('Erro ao deletar utilizador:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async deleteBroker(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await connection.query('DELETE FROM brokers WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Corretor deletado com sucesso.' });
        } catch (error) {
            console.error('Erro ao deletar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async deleteProperty(req: Request, res: Response) {
        const { id } = req.params;
        try {
            await connection.query('DELETE FROM properties WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Imóvel deletado pelo administrador com sucesso.' });
        } catch (error) {
            console.error('Erro ao deletar imóvel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async getDashboardStats(req: Request, res: Response) {
        try {
            const [propertiesResult] = await connection.query('SELECT COUNT(*) as total FROM properties');
            const [brokersResult] = await connection.query('SELECT COUNT(*) as total FROM brokers');
            const [usersResult] = await connection.query('SELECT COUNT(*) as total FROM users');

            const stats = {
                totalProperties: (propertiesResult as any)[0].total,
                totalBrokers: (brokersResult as any)[0].total,
                totalUsers: (usersResult as any)[0].total
            };

            return res.json(stats);
        } catch (error) {
            console.error('Erro ao buscar estatísticas do dashboard:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async listPendingBrokers(req: Request, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;
            const offset = (page - 1) * limit;

            const countQuery = `SELECT COUNT(*) as total FROM brokers WHERE status = 'pending_verification'`;
            const [totalResult] = await connection.query(countQuery);
            const total = (totalResult as any[])[0].total;

            const dataQuery = `
                SELECT 
                    b.id, u.name, u.email, b.creci, b.status, b.created_at,
                    bd.creci_front_url, bd.creci_back_url, bd.selfie_url
                FROM brokers b
                JOIN users u ON b.id = u.id
                LEFT JOIN broker_documents bd ON b.id = bd.broker_id
                WHERE b.status = 'pending_verification'
                LIMIT ? OFFSET ?
            `;
            const [data] = await connection.query(dataQuery, [limit, offset]);

            return res.json({ data, total });
        } catch (error) {
            console.error('Erro ao listar corretores pendentes:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async approveBroker(req: Request, res: Response) {
        const { id } = req.params;

        try {
            await connection.query('UPDATE brokers SET status = ? WHERE id = ?', ['approved', id]);
            return res.status(200).json({ message: 'Corretor aprovado com sucesso!' });
        } catch (error) {
            console.error('Erro ao aprovar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }

    async rejectBroker(req: Request, res: Response) {
        const { id } = req.params;

        try {
            await connection.query('UPDATE brokers SET status = ? WHERE id = ?', ['rejected', id]);
            return res.status(200).json({ message: 'Corretor rejeitado com sucesso!' });
        } catch (error) {
            console.error('Erro ao rejeitar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
}

export const adminController = new AdminController();
