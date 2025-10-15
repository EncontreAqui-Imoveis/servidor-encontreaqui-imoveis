"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = __importDefault(require("../database/connection"));
const cloudinary_1 = require("../config/cloudinary");
const STATUS_MAP = {
    pendingapproval: 'pending_approval',
    pendente: 'pending_approval',
    pending: 'pending_approval',
    aprovado: 'approved',
    aprovada: 'approved',
    approved: 'approved',
    rejeitado: 'rejected',
    rejeitada: 'rejected',
    rejected: 'rejected',
    alugado: 'rented',
    alugada: 'rented',
    rented: 'rented',
    vendido: 'sold',
    vendida: 'sold',
    sold: 'sold',
};
const ALLOWED_STATUS = new Set([
    'pending_approval',
    'approved',
    'rejected',
    'rented',
    'sold',
]);
function normalizeStatus(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value
        .normalize('NFD')
        .replace(/[^\p{L}0-9]/gu, '')
        .toLowerCase();
    const status = STATUS_MAP[normalized];
    if (!status || !ALLOWED_STATUS.has(status)) {
        return null;
    }
    return status;
}
function parseDecimal(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error('Valor numerico invalido.');
    }
    return parsed;
}
function parseInteger(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error('Valor inteiro invalido.');
    }
    return Math.trunc(parsed);
}
function parseBoolean(value) {
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    if (typeof value === 'number') {
        return value === 0 ? 0 : 1;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['1', 'true', 'yes', 'sim', 'on'].includes(normalized) ? 1 : 0;
    }
    return 0;
}
function stringOrNull(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const textual = String(value).trim();
    return textual.length > 0 ? textual : null;
}
class AdminController {
    async login(req, res) {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
        }
        try {
            const [rows] = await connection_1.default.query('SELECT id, name, email, password_hash FROM admins WHERE email = ?', [email]);
            if (rows.length === 0) {
                return res.status(401).json({ error: 'Credenciais invalidas.' });
            }
            const admin = rows[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, String(admin.password_hash));
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: 'Credenciais invalidas.' });
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
            const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
            const offset = (page - 1) * limit;
            const searchTerm = String(req.query.search ?? '').trim();
            const searchColumn = String(req.query.searchColumn ?? 'p.title');
            const status = normalizeStatus(req.query.status);
            const sortBy = String(req.query.sortBy ?? 'p.created_at');
            const sortOrder = String(req.query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const allowedSearchColumns = new Set(['p.id', 'p.title', 'p.type', 'p.city', 'p.code', 'u.name']);
            const allowedSortColumns = new Set([
                'p.id',
                'p.title',
                'p.type',
                'p.city',
                'u.name',
                'p.price',
                'p.created_at',
                'p.code',
            ]);
            const safeSearchColumn = allowedSearchColumns.has(searchColumn) ? searchColumn : 'p.title';
            const safeSortBy = allowedSortColumns.has(sortBy) ? sortBy : 'p.created_at';
            const whereClauses = [];
            const params = [];
            if (searchTerm) {
                whereClauses.push(`${safeSearchColumn} LIKE ?`);
                params.push(`%${searchTerm}%`);
            }
            if (status) {
                whereClauses.push('p.status = ?');
                params.push(status);
            }
            const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            const [totalRows] = await connection_1.default.query(`SELECT COUNT(*) AS total FROM properties p ${where}`, params);
            const total = totalRows[0]?.total ?? 0;
            const [rows] = await connection_1.default.query(`
          SELECT
            p.id,
            p.code,
            p.title,
            p.type,
            p.status,
            p.price,
            p.city,
            p.bairro,
            p.purpose,
            p.created_at,
            u.name AS broker_name,
            u.phone AS broker_phone
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON b.id = u.id
          ${where}
          ORDER BY ${safeSortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `, [...params, limit, offset]);
            return res.json({ data: rows, total });
        }
        catch (error) {
            console.error('Erro ao listar imoveis com corretores:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async updateBroker(req, res) {
        const { id } = req.params;
        const { name, email, phone, creci, status, agencyId, agency_id } = req.body;
        const resolvedAgencyId = agencyId ?? agency_id;
        try {
            await connection_1.default.query('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?', [stringOrNull(name), stringOrNull(email), stringOrNull(phone), id]);
            const updates = [];
            const params = [];
            if (creci !== undefined) {
                updates.push('creci = ?');
                params.push(stringOrNull(creci));
            }
            if (status !== undefined) {
                const normalized = normalizeStatus(status);
                if (!normalized) {
                    return res.status(400).json({ error: 'Status de corretor invalido.' });
                }
                updates.push('status = ?');
                params.push(normalized);
            }
            if (resolvedAgencyId !== undefined) {
                updates.push('agency_id = ?');
                params.push(resolvedAgencyId ? Number(resolvedAgencyId) : null);
            }
            if (updates.length > 0) {
                params.push(id);
                await connection_1.default.query(`UPDATE brokers SET ${updates.join(', ')} WHERE id = ?`, params);
            }
            return res.status(200).json({ message: 'Corretor atualizado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao atualizar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async updateClient(req, res) {
        const { id } = req.params;
        const { name, email, phone, address, city, state } = req.body;
        try {
            await connection_1.default.query('UPDATE users SET name = ?, email = ?, phone = ?, address = ?, city = ?, state = ? WHERE id = ?', [
                stringOrNull(name),
                stringOrNull(email),
                stringOrNull(phone),
                stringOrNull(address),
                stringOrNull(city),
                stringOrNull(state),
                id,
            ]);
            return res.status(200).json({ message: 'Cliente atualizado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao atualizar cliente:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async getAllUsers(req, res) {
        try {
            const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
            const offset = (page - 1) * limit;
            const [totalRows] = await connection_1.default.query('SELECT COUNT(*) AS total FROM users');
            const total = totalRows[0]?.total ?? 0;
            const [rows] = await connection_1.default.query(`
          SELECT id, name, email, phone, role, created_at
          FROM users
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `, [limit, offset]);
            return res.json({ data: rows, total });
        }
        catch (error) {
            console.error('Erro ao listar usuarios:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async deleteUser(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('DELETE FROM users WHERE id = ?', [id]);
            return res.status(200).json({ message: 'Usuario deletado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao deletar usuario:', error);
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
            return res.status(200).json({ message: 'Imovel deletado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao deletar imovel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async updateProperty(req, res) {
        const { id } = req.params;
        const body = req.body ?? {};
        try {
            const [propertyRows] = await connection_1.default.query('SELECT id FROM properties WHERE id = ?', [id]);
            if (propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            const allowedFields = new Set([
                'title',
                'description',
                'type',
                'purpose',
                'status',
                'price',
                'code',
                'address',
                'quadra',
                'lote',
                'numero',
                'bairro',
                'complemento',
                'tipo_lote',
                'city',
                'state',
                'bedrooms',
                'bathrooms',
                'area_construida',
                'area_terreno',
                'garage_spots',
                'has_wifi',
                'tem_piscina',
                'tem_energia_solar',
                'tem_automacao',
                'tem_ar_condicionado',
                'eh_mobiliada',
                'valor_condominio',
                'valor_iptu',
                'video_url',
                'sale_value',
                'commission_rate',
                'commission_value',
            ]);
            const setParts = [];
            const params = [];
            for (const [key, value] of Object.entries(body)) {
                if (!allowedFields.has(key)) {
                    continue;
                }
                switch (key) {
                    case 'status': {
                        const normalized = normalizeStatus(value);
                        if (!normalized) {
                            return res.status(400).json({ error: 'Status invalido.' });
                        }
                        setParts.push('status = ?');
                        params.push(normalized);
                        break;
                    }
                    case 'price':
                    case 'sale_value':
                    case 'commission_rate':
                    case 'commission_value':
                    case 'area_construida':
                    case 'area_terreno':
                    case 'valor_condominio':
                    case 'valor_iptu': {
                        try {
                            setParts.push(`${key} = ?`);
                            params.push(parseDecimal(value));
                        }
                        catch (parseError) {
                            return res.status(400).json({ error: parseError.message });
                        }
                        break;
                    }
                    case 'bedrooms':
                    case 'bathrooms':
                    case 'garage_spots': {
                        try {
                            setParts.push(`${key} = ?`);
                            params.push(parseInteger(value));
                        }
                        catch (parseError) {
                            return res.status(400).json({ error: parseError.message });
                        }
                        break;
                    }
                    case 'has_wifi':
                    case 'tem_piscina':
                    case 'tem_energia_solar':
                    case 'tem_automacao':
                    case 'tem_ar_condicionado':
                    case 'eh_mobiliada': {
                        setParts.push(`${key} = ?`);
                        params.push(parseBoolean(value));
                        break;
                    }
                    default: {
                        setParts.push(`${key} = ?`);
                        params.push(stringOrNull(value));
                    }
                }
            }
            if (setParts.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado fornecido para atualizacao.' });
            }
            params.push(id);
            await connection_1.default.query(`UPDATE properties SET ${setParts.join(', ')} WHERE id = ?`, params);
            return res.status(200).json({ message: 'Imovel atualizado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao atualizar imovel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getDashboardStats(req, res) {
        try {
            const [propertiesResult] = await connection_1.default.query('SELECT COUNT(*) AS total FROM properties');
            const [brokersResult] = await connection_1.default.query('SELECT COUNT(*) AS total FROM brokers');
            const [usersResult] = await connection_1.default.query('SELECT COUNT(*) AS total FROM users');
            return res.json({
                totalProperties: propertiesResult[0]?.total ?? 0,
                totalBrokers: brokersResult[0]?.total ?? 0,
                totalUsers: usersResult[0]?.total ?? 0,
            });
        }
        catch (error) {
            console.error('Erro ao buscar estatisticas do dashboard:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async listPendingBrokers(req, res) {
        try {
            const [rows] = await connection_1.default.query(`
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            bd.creci_front_url,
            bd.creci_back_url,
            bd.selfie_url,
            bd.status AS document_status,
            b.created_at
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
          WHERE b.status = 'pending_verification'
            AND (bd.status = 'pending' OR bd.status IS NULL)
        `);
            return res.status(200).json({ data: rows });
        }
        catch (error) {
            console.error('Erro ao buscar corretores pendentes:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async getAllClients(req, res) {
        try {
            const [rows] = await connection_1.default.query(`
          SELECT u.id, u.name, u.email, u.phone, u.created_at
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE b.id IS NULL
        `);
            return res.status(200).json({ data: rows, total: rows.length });
        }
        catch (error) {
            console.error('Erro ao buscar clientes:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async approveBroker(req, res) {
        const { id } = req.params;
        try {
            await connection_1.default.query('UPDATE brokers SET status = ? WHERE id = ?', ['approved', id]);
            await connection_1.default.query('UPDATE broker_documents SET status = ? WHERE broker_id = ?', ['approved', id]);
            return res.status(200).json({ message: 'Corretor aprovado com sucesso.' });
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
            await connection_1.default.query('UPDATE broker_documents SET status = ? WHERE broker_id = ?', ['rejected', id]);
            return res.status(200).json({ message: 'Corretor rejeitado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao rejeitar corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getAllBrokers(req, res) {
        try {
            const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
            const offset = (page - 1) * limit;
            const [totalRows] = await connection_1.default.query('SELECT COUNT(*) AS total FROM brokers');
            const total = totalRows[0]?.total ?? 0;
            const [rows] = await connection_1.default.query(`
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            b.created_at,
            a.id AS agency_id,
            a.name AS agency_name,
            COUNT(p.id) AS property_count
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN properties p ON p.broker_id = b.id
          GROUP BY b.id, u.name, u.email, u.phone, b.creci, b.status, b.created_at, a.id, a.name
          ORDER BY b.created_at DESC
          LIMIT ? OFFSET ?
        `, [limit, offset]);
            return res.json({ data: rows, total });
        }
        catch (error) {
            console.error('Erro ao buscar corretores:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async approveProperty(req, res) {
        const propertyId = Number(req.params.id);
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        try {
            const [result] = await connection_1.default.query('UPDATE properties SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['approved', propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            return res.status(200).json({ message: 'Imovel aprovado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao aprovar imovel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async rejectProperty(req, res) {
        const propertyId = Number(req.params.id);
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        try {
            const [result] = await connection_1.default.query('UPDATE properties SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['rejected', propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            return res.status(200).json({ message: 'Imovel rejeitado com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao rejeitar imovel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async addPropertyImage(req, res) {
        const propertyId = Number(req.params.id);
        const files = req.files;
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
        }
        try {
            const [propertyRows] = await connection_1.default.query('SELECT id FROM properties WHERE id = ?', [propertyId]);
            if (propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            const uploadedUrls = [];
            for (const file of files) {
                const result = await (0, cloudinary_1.uploadToCloudinary)(file, 'properties/admin');
                uploadedUrls.push(result.url);
            }
            if (uploadedUrls.length > 0) {
                const values = uploadedUrls.map((url) => [propertyId, url]);
                await connection_1.default.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
            }
            return res.status(201).json({ message: 'Imagens adicionadas com sucesso.', images: uploadedUrls });
        }
        catch (error) {
            console.error('Erro ao adicionar imagens:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async deletePropertyImage(req, res) {
        const imageId = Number(req.params.imageId);
        if (Number.isNaN(imageId)) {
            return res.status(400).json({ error: 'Identificador de imagem invalido.' });
        }
        try {
            const [result] = await connection_1.default.query('DELETE FROM property_images WHERE id = ?', [imageId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Imagem nao encontrada.' });
            }
            return res.status(200).json({ message: 'Imagem removida com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao remover imagem:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
}
exports.adminController = new AdminController();
