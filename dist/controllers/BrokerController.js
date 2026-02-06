"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.brokerController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = __importDefault(require("../database/connection"));
const cloudinary_1 = require("../config/cloudinary");
const env_1 = require("../config/env");
const address_1 = require("../utils/address");
const jwtSecret = (0, env_1.requireEnv)("JWT_SECRET");
function toDate(value) {
    if (!value)
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function diffInWeeks(start, end) {
    const diffMs = end.getTime() - start.getTime();
    return Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
}
function diffInMonths(start, end) {
    let months = (end.getFullYear() - start.getFullYear()) * 12;
    months += end.getMonth() - start.getMonth();
    if (end.getDate() < start.getDate()) {
        months -= 1;
    }
    return Math.max(months, 0);
}
function diffInYears(start, end) {
    let years = end.getFullYear() - start.getFullYear();
    if (end.getMonth() < start.getMonth() ||
        (end.getMonth() === start.getMonth() && end.getDate() < start.getDate())) {
        years -= 1;
    }
    return Math.max(years, 0);
}
function calculateAutoCycles(intervalValue, saleDateValue) {
    const interval = typeof intervalValue === "string"
        ? intervalValue.trim().toLowerCase()
        : "none";
    if (interval !== "weekly" && interval !== "monthly" && interval !== "yearly") {
        return 0;
    }
    const saleDate = toDate(saleDateValue);
    if (!saleDate)
        return 0;
    const now = new Date();
    if (now <= saleDate)
        return 0;
    switch (interval) {
        case "weekly":
            return diffInWeeks(saleDate, now);
        case "monthly":
            return diffInMonths(saleDate, now);
        case "yearly":
            return diffInYears(saleDate, now);
        default:
            return 0;
    }
}
class BrokerController {
    async register(req, res) {
        const { name, email, password, creci, phone, street, number, complement, bairro, city, state, cep, agencyId, agency_id } = req.body;
        const resolvedAgencyId = agencyId ?? agency_id ?? null;
        try {
            const [existingUserRows] = await connection_1.default.query("SELECT id FROM users WHERE email = ?", [email]);
            const existingUsers = existingUserRows;
            if (existingUsers.length > 0) {
                return res.status(409).json({ error: "Este email já está em uso." });
            }
            const [existingCreciRows] = await connection_1.default.query("SELECT id FROM brokers WHERE creci = ?", [creci]);
            const existingCreci = existingCreciRows;
            if (existingCreci.length > 0) {
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }
            const addressResult = (0, address_1.sanitizeAddressInput)({
                street,
                number,
                complement,
                bairro,
                city,
                state,
                cep,
            });
            if (!addressResult.ok) {
                return res.status(400).json({
                    error: "Endereco incompleto ou invalido.",
                    fields: addressResult.errors,
                });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            const [userResult] = await connection_1.default.query("INSERT INTO users (name, email, password_hash, phone, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                name,
                email,
                passwordHash,
                phone ?? null,
                addressResult.value.street,
                addressResult.value.number,
                addressResult.value.complement,
                addressResult.value.bairro,
                addressResult.value.city,
                addressResult.value.state,
                addressResult.value.cep,
            ]);
            const userId = userResult.insertId;
            await connection_1.default.query("INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, ?, ?)", [userId, creci, "pending_documents", resolvedAgencyId ? Number(resolvedAgencyId) : null]);
            return res.status(201).json({ message: "Corretor registrado com sucesso!", brokerId: userId });
        }
        catch (error) {
            if (error?.code === "ER_DUP_ENTRY") {
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }
            console.error("Erro no registro do corretor:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }
    async registerWithDocs(req, res) {
        const { name, email, password, creci, phone, street, number, complement, bairro, city, state, cep, agencyId, agency_id } = req.body;
        const resolvedAgencyId = agencyId ?? agency_id ?? null;
        const files = req.files;
        if (!name || !email || !password || !creci) {
            return res.status(400).json({ error: "Nome, email, senha e CRECI s?o obrigat?rios." });
        }
        const addressResult = (0, address_1.sanitizeAddressInput)({
            street,
            number,
            complement,
            bairro,
            city,
            state,
            cep,
        });
        if (!addressResult.ok) {
            return res.status(400).json({
                error: "Endereco incompleto ou invalido.",
                fields: addressResult.errors,
            });
        }
        if (!files || !files.creciFront || !files.creciBack || !files.selfie) {
            return res.status(400).json({ error: "Envie as imagens da frente e verso do CRECI e a selfie." });
        }
        const creciFrontFile = files.creciFront[0];
        const creciBackFile = files.creciBack[0];
        const selfieFile = files.selfie[0];
        const db = await connection_1.default.getConnection();
        try {
            await db.beginTransaction();
            const [existingUserRows] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
            const existingUsers = existingUserRows;
            if (existingUsers.length > 0) {
                await db.rollback();
                return res.status(409).json({ error: "Este email já está em uso." });
            }
            const [existingCreciRows] = await db.query("SELECT id FROM brokers WHERE creci = ?", [creci]);
            const existingCreci = existingCreciRows;
            if (existingCreci.length > 0) {
                await db.rollback();
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            const [userResult] = await db.query("INSERT INTO users (name, email, password_hash, phone, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                name,
                email,
                passwordHash,
                phone ?? null,
                addressResult.value.street,
                addressResult.value.number,
                addressResult.value.complement,
                addressResult.value.bairro,
                addressResult.value.city,
                addressResult.value.state,
                addressResult.value.cep,
            ]);
            const userId = userResult.insertId;
            await db.query("INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, ?, ?)", [userId, creci, "pending_verification", resolvedAgencyId ? Number(resolvedAgencyId) : null]);
            const creciFrontResult = await (0, cloudinary_1.uploadToCloudinary)(creciFrontFile, "brokers/documents");
            const creciBackResult = await (0, cloudinary_1.uploadToCloudinary)(creciBackFile, "brokers/documents");
            const selfieResult = await (0, cloudinary_1.uploadToCloudinary)(selfieFile, "brokers/documents");
            const creciFrontUrl = creciFrontResult.url;
            const creciBackUrl = creciBackResult.url;
            const selfieUrl = selfieResult.url;
            await db.query(`INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)
                 VALUES (?, ?, ?, ?, 'pending')
                 ON DUPLICATE KEY UPDATE
                   creci_front_url = VALUES(creci_front_url),
                   creci_back_url = VALUES(creci_back_url),
                   selfie_url = VALUES(selfie_url),
                   status = 'pending',
                   updated_at = CURRENT_TIMESTAMP`, [userId, creciFrontUrl, creciBackUrl, selfieUrl]);
            await db.commit();
            return res.status(201).json({
                message: "Corretor registrado com sucesso! Seus documentos foram enviados para an?lise.",
                broker: {
                    id: userId,
                    name,
                    email,
                    phone: phone ?? null,
                    street: addressResult.value.street,
                    number: addressResult.value.number,
                    complement: addressResult.value.complement,
                    bairro: addressResult.value.bairro,
                    city: addressResult.value.city,
                    state: addressResult.value.state,
                    cep: addressResult.value.cep,
                    status: "pending_verification"
                }
            });
        }
        catch (error) {
            await db.rollback();
            if (error?.code == "ER_DUP_ENTRY") {
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }
            console.error("Erro no registro com documentos:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
        finally {
            db.release();
        }
    }
    async requestUpgrade(req, res) {
        const brokerId = req.userId;
        const creci = req.body?.creci?.toString().trim() ?? '';
        if (!brokerId) {
            return res.status(401).json({ error: "Usuario nao autenticado." });
        }
        if (!creci) {
            return res.status(400).json({ error: "Informe o CRECI." });
        }
        try {
            const [creciRows] = await connection_1.default.query('SELECT id FROM brokers WHERE creci = ? AND id <> ?', [creci, brokerId]);
            if (creciRows.length > 0) {
                return res.status(409).json({ error: "Este CRECI ja esta em uso." });
            }
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [brokerId]);
            if (brokerRows.length === 0) {
                await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [brokerId, creci, 'pending_documents']);
                await connection_1.default.query('UPDATE users SET role = ? WHERE id = ?', ['broker', brokerId]);
                return res.status(201).json({ status: 'pending_documents', role: 'broker' });
            }
            const currentStatus = String(brokerRows[0].status ?? '').trim();
            if (currentStatus === 'rejected' || currentStatus === 'suspended') {
                return res.status(403).json({
                    error: "Sua solicitacao de corretor foi rejeitada.",
                });
            }
            await connection_1.default.query('UPDATE brokers SET creci = ? WHERE id = ?', [creci, brokerId]);
            return res.status(200).json({ status: currentStatus, role: 'broker' });
        }
        catch (error) {
            console.error("Erro ao solicitar upgrade de corretor:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }
    async login(req, res) {
        const { email, password } = req.body;
        try {
            const [userRows] = await connection_1.default.query(`SELECT
                   u.id,
                   u.name,
                   u.email,
                   u.password_hash,
                   u.phone,
                   u.street,
                   u.number,
                   u.complement,
                   u.bairro,
                   u.city,
                   u.state,
                   u.cep,
                   b.creci,
                   b.status AS broker_status
                 FROM users u
                 JOIN brokers b ON u.id = b.id
                 WHERE u.email = ?`, [email]);
            const users = userRows;
            if (users.length === 0) {
                return res.status(401).json({ error: "Credenciais inválidas." });
            }
            const user = users[0];
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, user.password_hash);
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: "Credenciais inválidas." });
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: "broker" }, jwtSecret, { expiresIn: "1d" });
            const { password_hash, ...userWithoutPassword } = user;
            return res.json({
                broker: {
                    ...userWithoutPassword,
                    role: "broker"
                },
                token
            });
        }
        catch (error) {
            console.error("Erro no login do corretor:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }
    async getMyProperties(req, res) {
        const brokerId = req.userId;
        try {
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 10;
            const offset = (page - 1) * limit;
            const countQuery = "SELECT COUNT(*) as total FROM properties WHERE broker_id = ?";
            const [totalResult] = await connection_1.default.query(countQuery, [brokerId]);
            const total = totalResult[0]?.total ?? 0;
            const dataQuery = `
                SELECT
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
                LEFT JOIN users u ON u.id = p.broker_id
                LEFT JOIN property_images pi ON p.id = pi.property_id
                WHERE p.broker_id = ?
                GROUP BY
                    p.id, p.broker_id, p.title, p.description, p.type, p.status, p.purpose, p.price, p.price_sale, p.price_rent, p.code,
                    p.address, p.quadra, p.lote, p.numero, p.bairro, p.complemento, p.tipo_lote,
                    p.city, p.state, p.bedrooms, p.bathrooms, p.area_construida, p.area_terreno,
                    p.garage_spots, p.has_wifi, p.tem_piscina, p.tem_energia_solar, p.tem_automacao,
                    p.tem_ar_condicionado, p.eh_mobiliada, p.valor_condominio, p.valor_iptu,
                    p.video_url, p.created_at, u.name, u.phone, u.email
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
            `;
            const [dataRows] = await connection_1.default.query(dataQuery, [brokerId, limit, offset]);
            const parseBool = (value) => value === 1 || value === "1" || value === true;
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
                images: row.images ? row.images.split(",") : []
            }));
            return res.json({
                success: true,
                data: properties,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            });
        }
        catch (error) {
            console.error("Erro ao buscar im?veis do corretor:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
    async getMyCommissions(req, res) {
        const brokerId = req.userId;
        try {
            const query = `
                SELECT
                    s.id,
                    p.title,
                    s.deal_type,
                    s.sale_price,
                    s.commission_rate,
                    s.commission_amount,
                    s.iptu_value,
                    s.condominio_value,
                    s.is_recurring,
                    s.commission_cycles,
                    s.recurrence_interval,
                    s.sale_date
                FROM sales s
                JOIN properties p ON s.property_id = p.id
                WHERE s.broker_id = ?
                ORDER BY s.sale_date DESC
            `;
            const [commissions] = await connection_1.default.query(query, [brokerId]);
            return res.json({
                success: true,
                data: commissions.map((row) => {
                    const baseCycles = Math.max(Number(row.commission_cycles) || 0, 0);
                    const autoCycles = calculateAutoCycles(row.recurrence_interval, row.sale_date);
                    const totalCycles = baseCycles + autoCycles;
                    const commissionAmount = Number(row.commission_amount) || 0;
                    return {
                        ...row,
                        commission_cycles_total: totalCycles,
                        commission_amount_total: Number((commissionAmount * totalCycles).toFixed(2)),
                    };
                })
            });
        }
        catch (error) {
            console.error("Erro ao buscar comissões:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
    async getMyPerformanceReport(req, res) {
        const brokerId = req.userId;
        try {
            const [salesRows] = await connection_1.default.query(`
                SELECT
                    deal_type,
                    commission_amount,
                    commission_cycles,
                    recurrence_interval,
                    sale_date,
                    iptu_value
                FROM sales
                WHERE broker_id = ?
                `, [brokerId]);
            let totalDeals = 0;
            let totalSales = 0;
            let totalRents = 0;
            let totalCommission = 0;
            let totalIptu = 0;
            for (const row of salesRows) {
                totalDeals += 1;
                const dealType = String(row.deal_type ?? "").toLowerCase();
                if (dealType === "sale") {
                    totalSales += 1;
                }
                else if (dealType === "rent") {
                    totalRents += 1;
                }
                const baseCycles = Math.max(Number(row.commission_cycles) || 0, 0);
                const autoCycles = calculateAutoCycles(row.recurrence_interval, row.sale_date);
                const totalCycles = baseCycles + autoCycles;
                const commissionAmount = Number(row.commission_amount) || 0;
                totalCommission += commissionAmount * totalCycles;
                const iptuValue = Number(row.iptu_value) || 0;
                totalIptu += iptuValue;
            }
            const propertiesQuery = `SELECT COUNT(*) as total_properties FROM properties WHERE broker_id = ?`;
            const [propertiesResult] = await connection_1.default.query(propertiesQuery, [brokerId]);
            const statusQuery = `
                SELECT 
                    status,
                    COUNT(*) as count
                FROM properties 
                WHERE broker_id = ? 
                GROUP BY status
            `;
            const [statusRows] = await connection_1.default.query(statusQuery, [brokerId]);
            const statusBreakdown = {};
            for (const row of statusRows) {
                statusBreakdown[row.status] = Number(row.count) || 0;
            }
            const report = {
                totalDeals: Number(totalDeals || 0),
                totalSales: Number(totalSales || 0),
                totalRents: Number(totalRents || 0),
                totalCommission: Number(totalCommission.toFixed(2)),
                totalIptu: Number(totalIptu.toFixed(2)),
                totalProperties: Number(propertiesResult[0]?.total_properties || 0),
                statusBreakdown: statusBreakdown
            };
            return res.json({
                success: true,
                data: report
            });
        }
        catch (error) {
            console.error('Erro ao gerar relatório de desempenho:', error);
            return res.status(500).json({
                success: false,
                error: 'Ocorreu um erro inesperado no servidor.'
            });
        }
    }
    async uploadVerificationDocs(req, res) {
        const brokerId = req.userId;
        if (!brokerId) {
            return res.status(401).json({
                success: false,
                error: "Corretor não autenticado."
            });
        }
        const files = req.files;
        const creci = req.body?.creci?.toString().trim() || '';
        if (!creci) {
            return res.status(400).json({
                success: false,
                error: "Informe o CRECI."
            });
        }
        if (!files.creciFront || !files.creciBack || !files.selfie) {
            return res.status(400).json({
                success: false,
                error: "É necessário enviar os três arquivos."
            });
        }
        const creciFrontResult = await (0, cloudinary_1.uploadToCloudinary)(files.creciFront[0], "brokers/documents");
        const creciBackResult = await (0, cloudinary_1.uploadToCloudinary)(files.creciBack[0], "brokers/documents");
        const selfieResult = await (0, cloudinary_1.uploadToCloudinary)(files.selfie[0], "brokers/documents");
        const creciFrontUrl = creciFrontResult.url;
        const creciBackUrl = creciBackResult.url;
        const selfieUrl = selfieResult.url;
        try {
            const [brokerStatusRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [brokerId]);
            const currentStatus = brokerStatusRows.length > 0
                ? String(brokerStatusRows[0].status ?? '').trim().toLowerCase()
                : '';
            if (currentStatus === 'rejected' || currentStatus === 'suspended') {
                return res.status(403).json({
                    success: false,
                    error: "Sua solicitacao foi rejeitada. Inicie novamente para se tornar corretor."
                });
            }
            // Garante que a linha em brokers existe; se não existir, cria com status pending_verification.
            if (brokerStatusRows.length === 0) {
                await connection_1.default.query('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)', [brokerId, creci, 'pending_verification']);
            }
            else if (currentStatus !== 'approved') {
                await connection_1.default.query('UPDATE brokers SET creci = ?, status = ? WHERE id = ?', [creci, 'pending_verification', brokerId]);
            }
            else {
                await connection_1.default.query('UPDATE brokers SET creci = ? WHERE id = ?', [creci, brokerId]);
            }
            const query = `
                INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)
                VALUES (?, ?, ?, ?, 'pending')
                ON DUPLICATE KEY UPDATE
                  creci_front_url = VALUES(creci_front_url),
                  creci_back_url = VALUES(creci_back_url),
                  selfie_url = VALUES(selfie_url),
                  status = 'pending';
            `;
            await connection_1.default.query(query, [brokerId, creciFrontUrl, creciBackUrl, selfieUrl]);
            return res.status(201).json({
                success: true,
                message: "Documentos enviados para análise com sucesso!"
            });
        }
        catch (error) {
            console.error("Erro ao guardar documentos de verificação:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
}
exports.brokerController = new BrokerController();
