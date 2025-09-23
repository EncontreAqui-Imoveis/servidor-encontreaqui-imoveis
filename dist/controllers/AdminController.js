"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = __importDefault(require("../database/connection"));
class AdminController {
    async login(req, res) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
        }
        try {
            const [rows] = await connection_1.default.query('SELECT * FROM admins WHERE email = ?', [email]);
            const admins = rows;
            if (admins.length === 0) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const admin = admins[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, admin.password_hash);
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const token = jsonwebtoken_1.default.sign({ id: admin.id, role: 'admin' }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '1d' });
            delete admin.password_hash;
            return res.status(200).json({ admin, token });
        }
        catch (error) {
            console.error('Erro no login do admin:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async listPropertiesWithBrokers(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const searchTerm = req.query.search || '';
            const searchColumn = req.query.searchColumn || 'p.title';
            const status = req.query.status;
            const sortBy = req.query.sortBy || 'p.id';
            const sortOrder = req.query.sortOrder || 'desc';
            const offset = (page - 1) * limit;
            const whereClauses = [];
            const queryParams = [];
            const allowedSearchColumns = ['p.id', 'p.title', 'p.type', 'p.city', 'p.code'];
            const allowedSortColumns = ['p.id', 'p.title', 'p.type', 'p.city', 'b.name', 'p.price', 'p.code'];
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
            const [totalResult] = await connection_1.default.query(countQuery, queryParams);
            const total = totalResult[0].total;
            const dataQuery = `
                SELECT
                    p.id, p.code, p.title, p.type, p.status, p.price, p.city, p.broker_id,
                    p.sale_value, p.commission_rate, p.commission_value,
                    b.name as broker_name
                FROM
                    properties p
                LEFT JOIN
                    brokers b ON p.broker_id = b.id
                ${whereStatement}
                ORDER BY ${safeSortBy} ${safeSortOrder}
                LIMIT ? OFFSET ?
            `;
            const [data] = await connection_1.default.query(dataQuery, [...queryParams, limit, offset]);
            return res.json({ data, total });
        }
        catch (error) {
            console.error(`Erro ao buscar imóveis com corretores:`, error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async updateProperty(req, res) {
        const { id } = req.params;
        const data = req.body;
        try {
            if (data.status === 'Vendido') {
                if (data.sale_value != null && data.commission_rate != null) {
                    const saleValue = parseFloat(data.sale_value);
                    const commissionRate = parseFloat(data.commission_rate);
                    data.commission_value = saleValue * (commissionRate / 100);
                }
            }
            else {
                data.sale_value = null;
                data.commission_value = null;
                data.commission_rate = null;
            }
            if (data.id)
                delete data.id;
            if (data.broker_name)
                delete data.broker_name; // Remove campo que não existe na tabela
            const fields = Object.keys(data);
            const values = Object.values(data);
            if (fields.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado fornecido para atualização.' });
            }
            const setClause = fields.map(field => `\`${field}\` = ?`).join(', ');
            const updateQuery = `UPDATE properties SET ${setClause} WHERE id = ?`;
            await connection_1.default.query(updateQuery, [...values, id]);
            return res.status(200).json({ message: 'Imóvel atualizado com sucesso!' });
        }
        catch (error) {
            // --- Linha mais importante para o diagnóstico ---
            console.error('ERRO DETALHADO AO ATUALIZAR IMÓVEL:', error);
            if (error.sqlMessage) {
                return res.status(500).json({ error: 'Erro na base de dados.', details: error.sqlMessage });
            }
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getAllBrokers(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const sortBy = req.query.sortBy || 'b.id';
        const sortOrder = req.query.sortOrder || 'desc';
        const allowedSortColumns = ['b.id', 'b.name', 'b.email', 'b.creci', 'property_count'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'b.id';
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        try {
            const countQuery = `SELECT COUNT(*) as total FROM brokers`;
            const [totalResult] = await connection_1.default.query(countQuery);
            const total = totalResult[0].total;
            const dataQuery = `
                SELECT
                    b.id, b.name, b.email, b.creci, b.created_at,
                    COUNT(p.id) AS property_count
                FROM
                    brokers b
                LEFT JOIN
                    properties p ON b.id = p.broker_id
                GROUP BY
                    b.id
                ORDER BY
                    ${safeSortBy} ${safeSortOrder}
                LIMIT ? OFFSET ?
            `;
            const [data] = await connection_1.default.query(dataQuery, [limit, offset]);
            return res.json({ data, total });
        }
        catch (error) {
            console.error(`Erro ao buscar corretores:`, error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getAllUsers(req, res) {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const sortBy = req.query.sortBy || 'id';
        const sortOrder = req.query.sortOrder || 'desc';
        const allowedSortColumns = ['id', 'name', 'email', 'phone'];
        const safeSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'id';
        const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        try {
            const countQuery = 'SELECT COUNT(*) as total FROM users';
            const [totalResult] = await connection_1.default.query(countQuery);
            const total = totalResult[0].total;
            const dataQuery = `
                SELECT id, name, email, phone, created_at FROM users
                ORDER BY ${safeSortBy} ${safeSortOrder}
                LIMIT ? OFFSET ?
            `;
            const [data] = await connection_1.default.query(dataQuery, [limit, offset]);
            return res.json({ data, total });
        }
        catch (error) {
            console.error(`Erro ao buscar usuários:`, error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async deleteUser(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('DELETE FROM users WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Utilizador deletado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao deletar utilizador:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async deleteBroker(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('DELETE FROM brokers WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Corretor deletado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao deletar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async deleteProperty(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('DELETE FROM properties WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Imóvel deletado pelo administrador com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao deletar imóvel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getDashboardStats(req, res) {
        try {
            const [propertiesResult] = await connection_1.default.query('SELECT COUNT(*) as total FROM properties');
            const [brokersResult] = await connection_1.default.query('SELECT COUNT(*) as total FROM brokers');
            const [usersResult] = await connection_1.default.query('SELECT COUNT(*) as total FROM users');
            const stats = {
                totalProperties: propertiesResult[0].total,
                totalBrokers: brokersResult[0].total,
                totalUsers: usersResult[0].total
            };
            return res.json(stats);
        }
        catch (error) {
            console.error('Erro ao buscar estatísticas do dashboard:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    // AdminController.ts
    async listPendingBrokers(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const countQuery = `SELECT COUNT(*) as total FROM brokers WHERE status = 'pending_verification'`;
            const [totalResult] = await connection_1.default.query(countQuery);
            const total = totalResult[0].total;
            const dataQuery = `
      SELECT 
        b.id, b.name, b.email, b.creci, b.status, b.created_at,
        bd.creci_front_url, bd.creci_back_url, bd.selfie_url
      FROM brokers b
      LEFT JOIN broker_documents bd ON b.id = bd.broker_id
      WHERE b.status = 'pending_verification'
      LIMIT ? OFFSET ?
    `;
            const [data] = await connection_1.default.query(dataQuery, [limit, offset]);
            return res.json({ data, total });
        }
        catch (error) {
            console.error('Erro ao listar corretores pendentes:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async approveBroker(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('UPDATE brokers SET status = ? WHERE id = ?', ['verified', id]);
            return res.status(200).json({ message: 'Corretor aprovado com sucesso!' });
        }
        catch (error) {
            console.error('Erro ao aprovar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async rejectBroker(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('UPDATE brokers SET status = ? WHERE id = ?', ['rejected', id]);
            return res.status(200).json({ message: 'Corretor rejeitado com sucesso!' });
        }
        catch (error) {
            console.error('Erro ao rejeitar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
}
exports.adminController = new AdminController();
