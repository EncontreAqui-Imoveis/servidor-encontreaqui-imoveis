"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminController = exports.getDashboardStats = void 0;
exports.sendNotification = sendNotification;
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
function toNullableNumber(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function mapAdminProperty(row) {
    const imageList = Array.isArray(row.images)
        ? row.images
        : row.images
            ? String(row.images)
                .split(',')
                .map((url) => url.trim())
                .filter(Boolean)
            : [];
    const images = imageList.map((url, index) => ({ id: index, url }));
    return {
        id: row.id,
        broker_id: row.broker_id ?? null,
        code: row.code ?? null,
        title: row.title,
        description: row.description ?? null,
        type: row.type ?? '',
        purpose: row.purpose ?? null,
        status: row.status,
        price: toNullableNumber(row.price) ?? 0,
        address: row.address ?? null,
        quadra: row.quadra ?? null,
        lote: row.lote ?? null,
        numero: row.numero ?? null,
        bairro: row.bairro ?? null,
        complemento: row.complemento ?? null,
        tipo_lote: row.tipo_lote ?? null,
        city: row.city ?? null,
        state: row.state ?? null,
        bedrooms: toNullableNumber(row.bedrooms),
        bathrooms: toNullableNumber(row.bathrooms),
        area_construida: toNullableNumber(row.area_construida),
        area_terreno: toNullableNumber(row.area_terreno),
        garage_spots: toNullableNumber(row.garage_spots),
        valor_condominio: toNullableNumber(row.valor_condominio),
        valor_iptu: toNullableNumber(row.valor_iptu),
        video_url: row.video_url ?? null,
        images,
        broker_name: row.broker_name ?? null,
        broker_phone: row.broker_phone ?? null,
        created_at: row.created_at ? String(row.created_at) : null,
        updated_at: row.updated_at ? String(row.updated_at) : null,
    };
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
            const city = String(req.query.city ?? '').trim();
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
                'p.status',
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
            else {
                whereClauses.push('p.status = ?');
                params.push('approved');
            }
            if (city) {
                whereClauses.push('p.city = ?');
                params.push(city);
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
            const searchTerm = String(req.query.search ?? '').trim();
            const whereClauses = [];
            const params = [];
            if (searchTerm) {
                whereClauses.push('(name LIKE ? OR email LIKE ?)');
                params.push(`%${searchTerm}%`, `%${searchTerm}%`);
            }
            const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            const [totalRows] = await connection_1.default.query(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
            const total = totalRows[0]?.total ?? 0;
            const [rows] = await connection_1.default.query(`
          SELECT id, name, email, phone, created_at
          FROM users
          ${whereSql}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `, [...params, limit, offset]);
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
            const [propertyRows] = await connection_1.default.query('SELECT id, status FROM properties WHERE id = ?', [id]);
            if (propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            const property = propertyRows[0];
            const currentStatus = String(property.status ?? '').trim().toLowerCase();
            const isApproved = currentStatus === 'approved';
            const bodyKeys = Object.keys(body);
            if (isApproved) {
                const invalidKeys = bodyKeys.filter((key) => key !== 'status');
                if (invalidKeys.length > 0) {
                    return res.status(403).json({
                        error: 'Imoveis aprovados so permitem atualizar o status.',
                    });
                }
            }
            const allowedFields = isApproved
                ? new Set(['status'])
                : new Set([
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
    async updateBrokerStatus(req, res) {
        const brokerId = Number(req.params.id);
        const { status } = req.body ?? {};
        if (Number.isNaN(brokerId)) {
            return res.status(400).json({ error: 'Identificador de corretor invalido.' });
        }
        if (typeof status !== 'string') {
            return res.status(400).json({ error: 'Status invalido.' });
        }
        const normalizedStatus = status.trim();
        const allowedStatuses = new Set(['pending_verification', 'approved', 'rejected']);
        if (!allowedStatuses.has(normalizedStatus)) {
            return res.status(400).json({ error: 'Status de corretor nao suportado.' });
        }
        try {
            const [result] = await connection_1.default.query('UPDATE brokers SET status = ? WHERE id = ?', [normalizedStatus, brokerId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Corretor nao encontrado.' });
            }
            if (normalizedStatus === 'approved' || normalizedStatus === 'rejected') {
                await connection_1.default.query('UPDATE broker_documents SET status = ? WHERE broker_id = ?', [
                    normalizedStatus,
                    brokerId,
                ]);
            }
            return res.status(200).json({
                message: 'Status do corretor atualizado com sucesso.',
                status: normalizedStatus,
            });
        }
        catch (error) {
            console.error('Erro ao atualizar status do corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async listBrokers(req, res) {
        try {
            const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
            const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
            const offset = (page - 1) * limit;
            const requestedStatus = String(req.query.status ?? '').trim();
            const searchTerm = String(req.query.search ?? '').trim();
            const allowedStatuses = new Set(['pending_verification', 'approved', 'rejected']);
            const whereClauses = [];
            const params = [];
            if (requestedStatus && allowedStatuses.has(requestedStatus)) {
                whereClauses.push('b.status = ?');
                params.push(requestedStatus);
            }
            if (searchTerm) {
                whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR b.creci LIKE ?)');
                params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
            }
            const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
            const [totalRows] = await connection_1.default.query(`
          SELECT COUNT(DISTINCT b.id) AS total
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          ${where}
        `, params);
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
            a.logo_url AS agency_logo_url,
            a.address AS agency_address,
            a.city AS agency_city,
            a.state AS agency_state,
            a.phone AS agency_phone,
            a.email AS agency_email,
            COUNT(p.id) AS property_count
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN properties p ON p.broker_id = b.id
          ${where}
          GROUP BY
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            b.created_at,
            a.id,
            a.name,
            a.logo_url,
            a.address,
            a.city,
            a.state,
            a.phone,
            a.email
          ORDER BY b.created_at DESC
          LIMIT ? OFFSET ?
        `, [...params, limit, offset]);
            return res.json({ data: rows, total });
        }
        catch (error) {
            console.error('Erro ao buscar corretores:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getPropertyDetails(req, res) {
        const propertyId = Number(req.params.id);
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        try {
            const [rows] = await connection_1.default.query(`
          SELECT
            p.*,
            ANY_VALUE(u.name) AS broker_name,
            ANY_VALUE(u.phone) AS broker_phone,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE p.id = ?
          GROUP BY p.id
        `, [propertyId]);
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: 'Imóvel nao encontrado.' });
            }
            const property = rows[0];
            if (property.images === null) {
                property.images = [];
            }
            else if (typeof property.images === 'string') {
                property.images = property.images.split(',').filter(Boolean);
            }
            return res.status(200).json(mapAdminProperty(property));
        }
        catch (error) {
            console.error('Erro ao buscar detalhes do imóvel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async approveProperty(req, res) {
        const propertyId = Number(req.params.id);
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        try {
            const [result] = await connection_1.default.query('UPDATE properties SET status = ? WHERE id = ?', [
                'approved',
                propertyId,
            ]);
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
            const [result] = await connection_1.default.query('UPDATE properties SET status = ? WHERE id = ?', [
                'rejected',
                propertyId,
            ]);
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
    async updatePropertyStatus(req, res) {
        const propertyId = Number(req.params.id);
        const { status } = req.body ?? {};
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imovel invalido.' });
        }
        if (typeof status !== 'string') {
            return res.status(400).json({ error: 'Status invalido.' });
        }
        const normalizedStatus = status.trim();
        const allowedStatuses = new Set(['pending_approval', 'approved', 'rejected', 'rented', 'sold']);
        if (!allowedStatuses.has(normalizedStatus)) {
            return res.status(400).json({ error: 'Status de imovel nao suportado.' });
        }
        try {
            const [result] = await connection_1.default.query('UPDATE properties SET status = ? WHERE id = ?', [normalizedStatus, propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Imovel nao encontrado.' });
            }
            return res.status(200).json({
                message: 'Status do imovel atualizado com sucesso.',
                status: normalizedStatus,
            });
        }
        catch (error) {
            console.error('Erro ao atualizar status do imovel:', error);
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
        const propertyId = Number(req.params.id);
        const imageId = Number(req.params.imageId);
        if (Number.isNaN(propertyId) || Number.isNaN(imageId)) {
            return res.status(400).json({ error: 'Identificadores invalidos.' });
        }
        try {
            const [result] = await connection_1.default.query('DELETE FROM property_images WHERE id = ? AND property_id = ?', [imageId, propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: 'Imagem nao encontrada para este imovel.' });
            }
            return res.status(200).json({ message: 'Imagem removida com sucesso.' });
        }
        catch (error) {
            console.error('Erro ao remover imagem:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getBrokerProperties(req, res) {
        const brokerId = Number(req.params.id);
        if (Number.isNaN(brokerId)) {
            return res.status(400).json({ error: 'Identificador de corretor invalido.' });
        }
        try {
            const [properties] = await connection_1.default.query(`
          SELECT
            p.id,
            p.title,
            p.status,
            p.type,
            p.purpose,
            p.price,
            p.address,
            p.city,
            p.state,
            p.created_at
          FROM properties p
          WHERE p.broker_id = ?
          ORDER BY p.created_at DESC
        `, [brokerId]);
            return res.status(200).json({ data: properties });
        }
        catch (error) {
            console.error('Erro ao buscar imoveis do corretor:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getNotifications(req, res) {
        const adminId = Number(req.userId);
        if (!adminId) {
            return res.status(401).json({ error: 'Administrador nao autenticado.' });
        }
        try {
            const [rows] = await connection_1.default.query(`
          SELECT
            id,
            message,
            related_entity_type,
            related_entity_id,
            is_read,
            created_at
          FROM notifications
          WHERE is_read = 0
          ORDER BY created_at DESC
        `);
            return res.status(200).json({ data: rows });
        }
        catch (error) {
            console.error('Erro ao buscar notificacoes:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
}
/**
 * Busca estatisticas agregadas para o dashboard do admin.
 */
const getDashboardStats = async (req, res) => {
    try {
        const propertiesByStatusQuery = `
      SELECT
        status,
        COUNT(*) AS count
      FROM properties
      GROUP BY status
    `;
        const newPropertiesQuery = `
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS count
      FROM properties
      WHERE created_at >= CURDATE() - INTERVAL 30 DAY
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;
        const [propertiesByStatusResult, newPropertiesResult] = await Promise.all([
            connection_1.default.query(propertiesByStatusQuery),
            connection_1.default.query(newPropertiesQuery),
        ]);
        const [propertiesByStatusRows] = propertiesByStatusResult;
        const [newPropertiesRows] = newPropertiesResult;
        return res.status(200).json({
            propertiesByStatus: propertiesByStatusRows ?? [],
            newPropertiesOverTime: newPropertiesRows ?? [],
        });
    }
    catch (error) {
        console.error('Erro ao buscar estatisticas do dashboard:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
};
exports.getDashboardStats = getDashboardStats;
async function sendNotification(req, res) {
    try {
        const { message, recipientId } = req.body;
        if (!message || typeof message !== 'string' || message.trim() === '') {
            return res.status(400).json({ error: 'A mensagem é obrigatória.' });
        }
        await connection_1.default.query(`
        INSERT INTO notifications (message, related_entity_type, recipient_id)
        VALUES (?, 'other', ?)
      `, [message.trim(), recipientId || null]);
        return res.status(201).json({ message: 'Notificação enviada com sucesso.' });
    }
    catch (error) {
        console.error('Erro ao enviar notificação:', error);
        return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
}
exports.adminController = new AdminController();
