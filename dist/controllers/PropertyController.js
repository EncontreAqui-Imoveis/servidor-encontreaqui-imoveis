"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyController = void 0;
const connection_1 = __importDefault(require("../database/connection"));
const cloudinary_1 = require("../config/cloudinary");
const notificationService_1 = require("../services/notificationService");
const STATUS_MAP = {
    pendingapproval: "pending_approval",
    pendente: "pending_approval",
    pending: "pending_approval",
    pendenteaprovacao: "pending_approval",
    aprovado: "approved",
    approved: "approved",
    aprovada: "approved",
    rejected: "rejected",
    rejeitado: "rejected",
    rejeitada: "rejected",
    rented: "rented",
    alugado: "rented",
    alugada: "rented",
    locado: "rented",
    locada: "rented",
    sold: "sold",
    vendido: "sold",
    vendida: "sold",
};
const ALLOWED_STATUSES = new Set([
    "pending_approval",
    "approved",
    "rejected",
    "rented",
    "sold",
]);
const NOTIFY_ON_STATUS = new Set(["sold", "rented"]);
function normalizeStatus(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value
        .normalize("NFD")
        .replace(/[^\p{L}0-9]/gu, "")
        .toLowerCase();
    const status = STATUS_MAP[normalized];
    if (!status || !ALLOWED_STATUSES.has(status)) {
        return null;
    }
    return status;
}
function parsePrice(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("Preço inválido.");
    }
    return parsed;
}
function parseDecimal(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error("Valor numérico inválido.");
    }
    return parsed;
}
function parseInteger(value) {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error("Valor inteiro inválido.");
    }
    return Math.trunc(parsed);
}
function parseBoolean(value) {
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "number") {
        return value === 0 ? 0 : 1;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return ["1", "true", "yes", "sim", "on"].includes(normalized) ? 1 : 0;
    }
    return 0;
}
function stringOrNull(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const str = String(value).trim();
    return str.length > 0 ? str : null;
}
function toBoolean(value) {
    return value === 1 || value === "1" || value === true;
}
function mapProperty(row) {
    const images = row.images ? row.images.split(",").filter(Boolean) : [];
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
        valor_condominio: row.valor_condominio != null ? Number(row.valor_condominio) : null,
        valor_iptu: row.valor_iptu != null ? Number(row.valor_iptu) : null,
        video_url: row.video_url ?? null,
        images,
        agency,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
class PropertyController {
    async show(req, res) {
        const propertyId = Number(req.params.id);
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: "Identificador de imóvel inválido." });
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
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE p.id = ?
          GROUP BY p.id
        `, [propertyId]);
            if (!rows || rows.length === 0) {
                return res.status(404).json({ error: "Imóvel não encontrado." });
            }
            return res.status(200).json(mapProperty(rows[0]));
        }
        catch (error) {
            console.error("Erro ao buscar imóvel:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async create(req, res) {
        const brokerId = req.userId;
        if (!brokerId) {
            return res.status(401).json({ error: "Corretor não autenticado." });
        }
        const { title, description, type, purpose, price, code, address, quadra, lote, numero, bairro, complemento, tipo_lote, city, state, bedrooms, bathrooms, area_construida, area_terreno, area, garage_spots, has_wifi, tem_piscina, tem_energia_solar, tem_automacao, tem_ar_condicionado, eh_mobiliada, valor_condominio, valor_iptu, } = req.body ?? {};
        if (!title || !description || !type || !purpose || !address || !city || !state) {
            return res.status(400).json({ error: "Campos obrigatórios não informados." });
        }
        let numericPrice;
        try {
            numericPrice = parsePrice(price);
        }
        catch (parseError) {
            return res.status(400).json({ error: parseError.message });
        }
        try {
            const [brokerRows] = await connection_1.default.query('SELECT status FROM brokers WHERE id = ?', [brokerId]);
            if (!brokerRows || brokerRows.length === 0) {
                return res.status(403).json({ error: "Conta de corretor não encontrada." });
            }
            const brokerStatus = String(brokerRows[0].status ?? '')
                .trim()
                .toLowerCase();
            if (brokerStatus !== 'approved') {
                return res
                    .status(403)
                    .json({ error: 'Apenas corretores aprovados podem criar imóveis.' });
            }
            const [duplicateRows] = await connection_1.default.query(`
          SELECT id FROM properties
          WHERE address = ?
            AND COALESCE(quadra, '') = COALESCE(?, '')
            AND COALESCE(lote, '') = COALESCE(?, '')
            AND COALESCE(numero, '') = COALESCE(?, '')
            AND COALESCE(bairro, '') = COALESCE(?, '')
          LIMIT 1
        `, [address, quadra ?? null, lote ?? null, numero ?? null, bairro ?? null]);
            if (duplicateRows.length > 0) {
                return res
                    .status(409)
                    .json({ error: 'Imóvel já cadastrado no sistema.' });
            }
            const numericBedrooms = parseInteger(bedrooms);
            const numericBathrooms = parseInteger(bathrooms);
            const numericGarageSpots = parseInteger(garage_spots);
            const numericAreaConstruida = parseDecimal(area_construida ?? area);
            const numericAreaTerreno = parseDecimal(area_terreno);
            const numericValorCondominio = parseDecimal(valor_condominio);
            const numericValorIptu = parseDecimal(valor_iptu);
            const hasWifiFlag = parseBoolean(has_wifi);
            const temPiscinaFlag = parseBoolean(tem_piscina);
            const temEnergiaSolarFlag = parseBoolean(tem_energia_solar);
            const temAutomacaoFlag = parseBoolean(tem_automacao);
            const temArCondicionadoFlag = parseBoolean(tem_ar_condicionado);
            const ehMobiliadaFlag = parseBoolean(eh_mobiliada);
            const imageUrls = [];
            const files = req.files ?? {};
            if (files.images) {
                for (const file of files.images) {
                    const uploaded = await (0, cloudinary_1.uploadToCloudinary)(file, 'properties');
                    imageUrls.push(uploaded.url);
                }
            }
            let videoUrl = null;
            if (files.video && files.video[0]) {
                const uploadedVideo = await (0, cloudinary_1.uploadToCloudinary)(files.video[0], 'videos');
                videoUrl = uploadedVideo.url;
            }
            const [result] = await connection_1.default.query(`
          INSERT INTO properties (
            broker_id,
            title,
            description,
            type,
            purpose,
            status,
            price,
            code,
            address,
            quadra,
            lote,
            numero,
            bairro,
            complemento,
            tipo_lote,
            city,
            state,
            bedrooms,
            bathrooms,
            area_construida,
            area_terreno,
            garage_spots,
            has_wifi,
            tem_piscina,
            tem_energia_solar,
            tem_automacao,
            tem_ar_condicionado,
            eh_mobiliada,
            valor_condominio,
            valor_iptu,
            video_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
                brokerId,
                title,
                description,
                type,
                purpose,
                'pending_approval',
                numericPrice,
                stringOrNull(code),
                address,
                stringOrNull(quadra),
                stringOrNull(lote),
                stringOrNull(numero),
                stringOrNull(bairro),
                stringOrNull(complemento),
                stringOrNull(tipo_lote),
                city,
                state,
                numericBedrooms,
                numericBathrooms,
                numericAreaConstruida,
                numericAreaTerreno,
                numericGarageSpots,
                hasWifiFlag,
                temPiscinaFlag,
                temEnergiaSolarFlag,
                temAutomacaoFlag,
                temArCondicionadoFlag,
                ehMobiliadaFlag,
                numericValorCondominio,
                numericValorIptu,
                videoUrl,
            ]);
            const propertyId = result.insertId;
            if (imageUrls.length > 0) {
                const values = imageUrls.map((url) => [propertyId, url]);
                await connection_1.default.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
            }
            try {
                await (0, notificationService_1.notifyAdmins)(`Um novo imóvel '${title}' foi adicionado e aguarda aprovação.`, 'property', propertyId);
            }
            catch (notifyError) {
                console.error('Erro ao enviar notificação aos administradores:', notifyError);
            }
            return res.status(201).json({
                message: 'Imóvel criado com sucesso!',
                propertyId,
                status: 'pending_approval',
                images: imageUrls,
                video: videoUrl,
            });
        }
        catch (error) {
            console.error('Erro ao criar imóvel:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async update(req, res) {
        const propertyId = Number(req.params.id);
        const brokerId = req.userId;
        if (!brokerId) {
            return res.status(401).json({ error: 'Corretor não autenticado.' });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
        }
        try {
            const [propertyRows] = await connection_1.default.query('SELECT * FROM properties WHERE id = ?', [propertyId]);
            if (!propertyRows || propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imóvel não encontrado.' });
            }
            const property = propertyRows[0];
            if (property.broker_id !== brokerId) {
                return res.status(403).json({ error: 'Acesso não autorizado a este imóvel.' });
            }
            const body = req.body ?? {};
            const bodyKeys = Object.keys(body);
            if (property.status === 'approved') {
                const invalidKeys = bodyKeys.filter((key) => key !== 'status');
                if (invalidKeys.length > 0) {
                    return res.status(403).json({
                        error: 'Imóveis aprovados não podem ter seus dados alterados, apenas o status.',
                    });
                }
            }
            const updatableFields = property.status === 'approved'
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
                ]);
            const fields = [];
            const values = [];
            let nextStatus = null;
            for (const key of bodyKeys) {
                if (!updatableFields.has(key)) {
                    continue;
                }
                switch (key) {
                    case 'status': {
                        const normalized = normalizeStatus(body.status);
                        if (!normalized) {
                            return res.status(400).json({ error: 'Status informado é inválido.' });
                        }
                        nextStatus = normalized;
                        fields.push('status = ?');
                        values.push(normalized);
                        break;
                    }
                    case 'price': {
                        try {
                            fields.push('price = ?');
                            values.push(parsePrice(body.price));
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
                            fields.push(`\`${key}\` = ?`);
                            values.push(parseInteger(body[key]));
                        }
                        catch (parseError) {
                            return res.status(400).json({ error: parseError.message });
                        }
                        break;
                    }
                    case 'area_construida':
                    case 'area_terreno':
                    case 'valor_condominio':
                    case 'valor_iptu': {
                        try {
                            fields.push(`\`${key}\` = ?`);
                            values.push(parseDecimal(body[key]));
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
                        fields.push(`\`${key}\` = ?`);
                        values.push(parseBoolean(body[key]));
                        break;
                    }
                    default: {
                        fields.push(`\`${key}\` = ?`);
                        values.push(stringOrNull(body[key]));
                    }
                }
            }
            if (fields.length === 0) {
                return res.status(400).json({ error: 'Nenhum dado fornecido para atualização.' });
            }
            values.push(propertyId);
            await connection_1.default.query(`UPDATE properties SET ${fields.join(', ')} WHERE id = ?`, values);
            if (Array.isArray(body.images) && property.status !== 'approved') {
                const images = body.images
                    .filter((url) => typeof url === 'string' && url.trim().length > 0)
                    .map((url) => url.trim());
                await connection_1.default.query('DELETE FROM property_images WHERE property_id = ?', [propertyId]);
                if (images.length > 0) {
                    const imageValues = images.map((url) => [propertyId, url]);
                    await connection_1.default.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [imageValues]);
                }
            }
            if (nextStatus && NOTIFY_ON_STATUS.has(nextStatus)) {
                try {
                    const action = nextStatus === 'sold' ? 'vendido' : 'alugado';
                    await (0, notificationService_1.notifyAdmins)(`O imóvel '${property.title}' foi marcado como ${action}.`, 'property', propertyId);
                }
                catch (notifyError) {
                    console.error('Erro ao registrar notificação:', notifyError);
                }
                if (nextStatus === 'sold') {
                    const salePrice = Number(body.price ?? property.price);
                    const commissionRate = parseDecimal(body.commission_rate) ?? 5.0;
                    const commissionAmount = Number((salePrice * (commissionRate / 100)).toFixed(2));
                    const [existingSaleRows] = await connection_1.default.query('SELECT id FROM sales WHERE property_id = ?', [propertyId]);
                    if (existingSaleRows.length > 0) {
                        await connection_1.default.query(`UPDATE sales
                 SET sale_price = ?, commission_rate = ?, commission_amount = ?, sale_date = CURRENT_TIMESTAMP
               WHERE property_id = ?`, [salePrice, commissionRate, commissionAmount, propertyId]);
                    }
                    else {
                        await connection_1.default.query(`INSERT INTO sales (property_id, broker_id, sale_price, commission_rate, commission_amount)
               VALUES (?, ?, ?, ?, ?)`, [propertyId, brokerId, salePrice, commissionRate, commissionAmount]);
                    }
                }
            }
            return res.status(200).json({ message: 'Imóvel atualizado com sucesso!' });
        }
        catch (error) {
            console.error('Erro ao atualizar imóvel:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
    async updateStatus(req, res) {
        const { status } = req.body;
        const normalized = normalizeStatus(status);
        if (!normalized) {
            return res.status(400).json({ error: 'Status informado é inválido.' });
        }
        req.body = { status: normalized };
        return this.update(req, res);
    }
    async delete(req, res) {
        const propertyId = Number(req.params.id);
        const brokerId = req.userId;
        if (!brokerId) {
            return res.status(401).json({ error: 'Corretor não autenticado.' });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
        }
        try {
            const [propertyRows] = await connection_1.default.query('SELECT broker_id FROM properties WHERE id = ?', [propertyId]);
            if (!propertyRows || propertyRows.length === 0) {
                return res.status(404).json({ error: 'Imóvel não encontrado.' });
            }
            if (propertyRows[0].broker_id !== brokerId) {
                return res.status(403).json({ error: 'Você não tem permissão para deletar este imóvel.' });
            }
            await connection_1.default.query('DELETE FROM properties WHERE id = ?', [propertyId]);
            return res.status(200).json({ message: 'Imóvel deletado com sucesso!' });
        }
        catch (error) {
            console.error('Erro ao deletar imóvel:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async getAvailableCities(req, res) {
        try {
            const [rows] = await connection_1.default.query(`
          SELECT DISTINCT city
          FROM properties
          WHERE city IS NOT NULL AND city <> ''
          ORDER BY city ASC
        `);
            return res.status(200).json(rows.map((row) => row.city));
        }
        catch (error) {
            console.error('Erro ao buscar cidades disponíveis:', error);
            return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
        }
    }
    async listPublicProperties(req, res) {
        const { page = '1', limit = '20', type, purpose, city, bairro, minPrice, maxPrice, bedrooms, sortBy, order, searchTerm, status, } = req.query;
        const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const numericPage = Math.max(Number(page) || 1, 1);
        const offset = (numericPage - 1) * numericLimit;
        const whereClauses = [];
        const params = [];
        const statusFilter = normalizeStatus(status);
        const effectiveStatus = statusFilter ?? 'approved';
        whereClauses.push('p.status = ?');
        params.push(effectiveStatus);
        if (type) {
            whereClauses.push('p.type = ?');
            params.push(type);
        }
        if (purpose) {
            whereClauses.push('p.purpose = ?');
            params.push(purpose);
        }
        if (city) {
            whereClauses.push('p.city LIKE ?');
            params.push(`%${city}%`);
        }
        if (bairro) {
            whereClauses.push('p.bairro LIKE ?');
            params.push(`%${bairro}%`);
        }
        if (minPrice) {
            const value = Number(minPrice);
            if (!Number.isNaN(value)) {
                whereClauses.push('p.price >= ?');
                params.push(value);
            }
        }
        if (maxPrice) {
            const value = Number(maxPrice);
            if (!Number.isNaN(value)) {
                whereClauses.push('p.price <= ?');
                params.push(value);
            }
        }
        if (bedrooms) {
            const value = Number(bedrooms);
            if (!Number.isNaN(value) && value > 0) {
                whereClauses.push('p.bedrooms >= ?');
                params.push(Math.trunc(value));
            }
        }
        if (searchTerm) {
            const term = `%${searchTerm}%`;
            whereClauses.push('(p.title LIKE ? OR p.city LIKE ? OR p.address LIKE ? OR p.bairro LIKE ? )');
            params.push(term, term, term, term);
        }
        const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const allowedSortColumns = {
            price: 'p.price',
            created_at: 'p.created_at',
            area_construida: 'p.area_construida',
        };
        const sortColumn = allowedSortColumns[String(sortBy ?? '').toLowerCase()] ?? 'p.created_at';
        const sortDirection = String(order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
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
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          ${where}
          GROUP BY p.id
          ORDER BY ${sortColumn} ${sortDirection}
          LIMIT ? OFFSET ?
        `, [...params, numericLimit, offset]);
            const [totalRows] = await connection_1.default.query(`SELECT COUNT(DISTINCT p.id) AS total FROM properties p ${where}`, params);
            const total = totalRows[0]?.total ?? 0;
            return res.json({
                properties: rows.map(mapProperty),
                total,
                page: numericPage,
                totalPages: Math.ceil(total / numericLimit),
            });
        }
        catch (error) {
            console.error('Erro ao listar imóveis:', error);
            return res.status(500).json({ error: 'Erro interno do servidor.' });
        }
    }
}
exports.propertyController = new PropertyController();
