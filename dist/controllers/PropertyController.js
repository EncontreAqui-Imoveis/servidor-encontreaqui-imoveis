"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.propertyController = void 0;
const connection_1 = __importDefault(require("../database/connection"));
const cloudinary_1 = require("../config/cloudinary");
const normalizeStatus = (value) => value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]/g, "");
class PropertyController {
    async index(req, res) {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const { type, purpose, city, minPrice, maxPrice, searchTerm } = req.query;
            const whereClauses = [];
            const queryParams = [];
            if (type) {
                whereClauses.push("type = ?");
                queryParams.push(type);
            }
            if (purpose) {
                whereClauses.push("purpose = ?");
                queryParams.push(purpose);
            }
            if (city) {
                whereClauses.push("city LIKE ?");
                queryParams.push(`%${city}%`);
            }
            if (minPrice) {
                whereClauses.push("price >= ?");
                queryParams.push(parseFloat(minPrice));
            }
            if (maxPrice) {
                whereClauses.push("price <= ?");
                queryParams.push(parseFloat(maxPrice));
            }
            if (searchTerm) {
                whereClauses.push("title LIKE ?");
                queryParams.push(`%${searchTerm}%`);
            }
            const whereStatement = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
            const countQuery = `SELECT COUNT(*) as total FROM properties ${whereStatement}`;
            const [totalResult] = await connection_1.default.query(countQuery, queryParams);
            const total = totalResult[0].total;
            const dataQuery = `SELECT id, title, type, status, price, address, city, bedrooms, bathrooms, area, garage_spots, has_wifi, broker_id, created_at FROM properties ${whereStatement} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
            const [data] = await connection_1.default.query(dataQuery, [...queryParams, limit, offset]);
            return res.json({ data, total });
        }
        catch (error) {
            console.error("Erro ao listar imoveis:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async show(req, res) {
        const { id } = req.params;
        try {
            const [rows] = await connection_1.default.query("SELECT * FROM properties WHERE id = ?", [id]);
            const properties = rows;
            if (properties.length === 0) {
                return res.status(404).json({ error: "Imovel nao encontrado." });
            }
            return res.status(200).json(properties[0]);
        }
        catch (error) {
            console.error("Erro ao buscar imovel:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async create(req, res) {
        try {
            const brokerId = req.userId;
            const { title, description, type, purpose, price, address, city, state, bedrooms, bathrooms, area, garage_spots, has_wifi } = req.body;
            const [brokerRows] = await connection_1.default.query("SELECT status FROM brokers WHERE id = ?", [brokerId]);
            if (brokerRows.length === 0) {
                return res.status(403).json({ error: "Conta de corretor nao encontrada para este utilizador." });
            }
            const brokerStatus = normalizeStatus(brokerRows[0]?.status ?? "");
            const allowedStatuses = new Set(["approved", "aprovado", "verified", "verificado"]);
            if (!allowedStatuses.has(brokerStatus)) {
                return res.status(403).json({ error: "Apenas corretores aprovados podem criar imoveis." });
            }
            const imageUrls = [];
            if (req.files && req.files["images"]) {
                for (const file of req.files["images"]) {
                    const result = await (0, cloudinary_1.uploadToCloudinary)(file, "properties");
                    imageUrls.push(result.url);
                }
            }
            let videoUrl = null;
            if (req.files && req.files["video"] && req.files["video"][0]) {
                const result = await (0, cloudinary_1.uploadToCloudinary)(req.files["video"][0], "videos");
                videoUrl = result.url;
            }
            const [result] = await connection_1.default.query(`INSERT INTO properties
           (title, description, type, purpose, price, address, city, state, bedrooms, bathrooms, area,
            garage_spots, has_wifi, broker_id, video_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                title,
                description,
                type,
                purpose,
                price,
                address,
                city,
                state,
                bedrooms ?? null,
                bathrooms ?? null,
                area ?? null,
                garage_spots ?? null,
                has_wifi ? 1 : 0,
                brokerId,
                videoUrl
            ]);
            const propertyId = result.insertId;
            if (imageUrls.length > 0) {
                const imageValues = imageUrls.map((url) => [propertyId, url]);
                await connection_1.default.query("INSERT INTO property_images (property_id, image_url) VALUES ?", [imageValues]);
            }
            return res.status(201).json({
                message: "Imovel criado com sucesso!",
                propertyId,
                images: imageUrls.length,
                video: Boolean(videoUrl)
            });
        }
        catch (error) {
            console.error("Erro ao criar imovel:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }
    async update(req, res) {
        const { id } = req.params;
        const { title, description, type, status, purpose, price, address, city, state, bedrooms, bathrooms, area } = req.body;
        const brokerIdFromToken = req.userId;
        try {
            const [propertyRows] = await connection_1.default.query("SELECT broker_id FROM properties WHERE id = ?", [id]);
            const properties = propertyRows;
            if (properties.length === 0) {
                return res.status(404).json({ error: "Imovel nao encontrado." });
            }
            const property = properties[0];
            if (property.broker_id !== brokerIdFromToken) {
                return res.status(403).json({ error: "Voce nao tem permissao para alterar este imovel." });
            }
            const updateQuery = `
        UPDATE properties
        SET title = ?, description = ?, type = ?, status = ?, purpose = ?, price = ?, address = ?, city = ?, state = ?, bedrooms = ?, bathrooms = ?, area = ?
        WHERE id = ?
      `;
            await connection_1.default.query(updateQuery, [
                title,
                description,
                type,
                status,
                purpose,
                price,
                address,
                city,
                state,
                bedrooms,
                bathrooms,
                area,
                id
            ]);
            return res.status(200).json({ message: "Imovel atualizado com sucesso!" });
        }
        catch (error) {
            console.error("Erro ao atualizar imovel:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async updateStatus(req, res) {
        const { id } = req.params;
        const { status } = req.body;
        const brokerIdFromToken = req.userId;
        if (!status) {
            return res.status(400).json({ error: "O novo status e obrigatorio." });
        }
        const normalizedStatus = normalizeStatus(status);
        const statusDictionary = {
            disponivel: "Disponivel",
            disponive: "Disponivel",
            negociando: "Negociando",
            negociacao: "Negociando",
            alugado: "Alugado",
            aluguel: "Alugado",
            vendido: "Vendido",
            venda: "Vendido"
        };
        const nextStatus = statusDictionary[normalizedStatus];
        if (!nextStatus) {
            return res.status(400).json({ error: "Status informado e invalido." });
        }
        try {
            const [propertyRows] = await connection_1.default.query("SELECT broker_id, price FROM properties WHERE id = ?", [id]);
            const properties = propertyRows;
            if (properties.length === 0) {
                return res.status(404).json({ error: "Imovel nao encontrado." });
            }
            const property = properties[0];
            if (property.broker_id !== brokerIdFromToken) {
                return res.status(403).json({ error: "Voce nao tem permissao para alterar este imovel." });
            }
            await connection_1.default.query("UPDATE properties SET status = ? WHERE id = ?", [nextStatus, id]);
            if (nextStatus === "Vendido") {
                const salePrice = Number(property.price);
                const commissionRate = 5.0;
                const commissionAmount = parseFloat((salePrice * (commissionRate / 100)).toFixed(2));
                const [existingSaleRows] = await connection_1.default.query("SELECT id FROM sales WHERE property_id = ?", [id]);
                const existingSales = existingSaleRows;
                if (existingSales.length > 0) {
                    await connection_1.default.query("UPDATE sales SET sale_price = ?, commission_rate = ?, commission_amount = ?, sale_date = CURRENT_TIMESTAMP WHERE property_id = ?", [salePrice, commissionRate, commissionAmount, id]);
                }
                else {
                    await connection_1.default.query("INSERT INTO sales (property_id, broker_id, sale_price, commission_rate, commission_amount) VALUES (?, ?, ?, ?, ?)", [id, brokerIdFromToken, salePrice, commissionRate, commissionAmount]);
                }
            }
            return res.status(200).json({ message: "Status do imovel atualizado com sucesso!", status: nextStatus });
        }
        catch (error) {
            console.error("Erro ao atualizar status do imovel:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async delete(req, res) {
        const { id } = req.params;
        const brokerIdFromToken = req.userId;
        try {
            const [propertyRows] = await connection_1.default.query("SELECT broker_id FROM properties WHERE id = ?", [id]);
            const properties = propertyRows;
            if (properties.length === 0) {
                return res.status(404).json({ error: "Imovel nao encontrado." });
            }
            if (properties[0].broker_id !== brokerIdFromToken) {
                return res.status(403).json({ error: "Voce nao tem permissao para deletar este imovel." });
            }
            await connection_1.default.query("DELETE FROM properties WHERE id = ?", [id]);
            return res.status(200).json({ message: "Imovel deletado com sucesso!" });
        }
        catch (error) {
            console.error("Erro ao deletar imovel:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async getAvailableCities(req, res) {
        try {
            const query = `
        SELECT DISTINCT city
        FROM properties
        WHERE city IS NOT NULL AND city != ''
        ORDER BY city ASC
      `;
            const [rows] = await connection_1.default.query(query);
            const cities = rows.map((row) => row.city);
            return res.status(200).json(cities);
        }
        catch (error) {
            console.error("Erro ao buscar cidades disponiveis:", error);
            return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
        }
    }
    async addFavorite(req, res) {
        const userId = req.userId;
        const propertyId = Number.parseInt(req.params.id, 10);
        if (!userId) {
            return res.status(401).json({ error: "Usuario nao autenticado." });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: "Identificador de imovel invalido." });
        }
        try {
            const [propertyRows] = await connection_1.default.query("SELECT id FROM properties WHERE id = ?", [propertyId]);
            if (propertyRows.length === 0) {
                return res.status(404).json({ error: "Imovel nao encontrado." });
            }
            const [favoriteRows] = await connection_1.default.query("SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?", [userId, propertyId]);
            if (favoriteRows.length > 0) {
                return res.status(409).json({ error: "Este imovel ja esta nos seus favoritos." });
            }
            await connection_1.default.query("INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)", [userId, propertyId]);
            return res.status(201).json({ message: "Imovel adicionado aos favoritos." });
        }
        catch (error) {
            console.error("Erro ao adicionar favorito:", error);
            return res.status(500).json({ error: "Ocorreu um erro no servidor." });
        }
    }
    async removeFavorite(req, res) {
        const userId = req.userId;
        const propertyId = Number.parseInt(req.params.id, 10);
        if (!userId) {
            return res.status(401).json({ error: "Usuario nao autenticado." });
        }
        if (Number.isNaN(propertyId)) {
            return res.status(400).json({ error: "Identificador de imovel invalido." });
        }
        try {
            const [result] = await connection_1.default.query("DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?", [userId, propertyId]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Favorito nao encontrado." });
            }
            return res.status(200).json({ message: "Imovel removido dos favoritos." });
        }
        catch (error) {
            console.error("Erro ao remover favorito:", error);
            return res.status(500).json({ error: "Ocorreu um erro no servidor." });
        }
    }
    async listUserFavorites(req, res) {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ error: "Usuario nao autenticado." });
        }
        try {
            const [rows] = await connection_1.default.query(`
          SELECT
            p.*,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
            u.name AS broker_name,
            u.phone AS broker_phone,
            u.email AS broker_email
          FROM favoritos f
          JOIN properties p ON p.id = f.imovel_id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          LEFT JOIN users u ON u.id = p.broker_id
          WHERE f.usuario_id = ?
          GROUP BY p.id
          ORDER BY f.created_at DESC
        `, [userId]);
            const favorites = rows.map((row) => ({
                ...row,
                images: row.images ? row.images.split(",") : [],
                price: Number(row.price)
            }));
            return res.status(200).json(favorites);
        }
        catch (error) {
            console.error("Erro ao listar favoritos:", error);
            return res.status(500).json({ error: "Ocorreu um erro no servidor." });
        }
    }
    async listPublicProperties(req, res) {
        try {
            const { page = "1", limit = "20", type, purpose, city, minPrice, maxPrice, bedrooms, sortBy, order, searchTerm, status } = req.query;
            const getParam = (value) => {
                if (Array.isArray(value) && value.length > 0) {
                    return typeof value[0] === "string" ? value[0] : undefined;
                }
                return typeof value === "string" ? value : undefined;
            };
            const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
            const numericPage = Math.max(Number(page) || 1, 1);
            const offset = (numericPage - 1) * numericLimit;
            const whereClauses = [];
            const queryParams = [];
            const statusFilter = getParam(status);
            if (statusFilter) {
                whereClauses.push("p.status = ?");
                queryParams.push(statusFilter);
            }
            else {
                const availableStatuses = ["Disponivel", "Disponivel"];
                whereClauses.push(`p.status IN (${availableStatuses.map(() => "?").join(", ")})`);
                queryParams.push(...availableStatuses);
            }
            const typeFilter = getParam(type);
            if (typeFilter) {
                whereClauses.push("p.type = ?");
                queryParams.push(typeFilter);
            }
            const purposeFilter = getParam(purpose);
            if (purposeFilter) {
                whereClauses.push("p.purpose = ?");
                queryParams.push(purposeFilter);
            }
            const cityFilter = getParam(city);
            if (cityFilter) {
                whereClauses.push("p.city LIKE ?");
                queryParams.push(`%${cityFilter}%`);
            }
            const minPriceValue = Number(getParam(minPrice) ?? minPrice);
            if (!Number.isNaN(minPriceValue) && minPriceValue > 0) {
                whereClauses.push("p.price >= ?");
                queryParams.push(minPriceValue);
            }
            const maxPriceValue = Number(getParam(maxPrice) ?? maxPrice);
            if (!Number.isNaN(maxPriceValue) && maxPriceValue > 0) {
                whereClauses.push("p.price <= ?");
                queryParams.push(maxPriceValue);
            }
            const bedroomsValue = Number(getParam(bedrooms) ?? bedrooms);
            if (!Number.isNaN(bedroomsValue) && bedroomsValue > 0) {
                whereClauses.push("p.bedrooms >= ?");
                queryParams.push(Math.floor(bedroomsValue));
            }
            const searchTermFilter = getParam(searchTerm);
            if (searchTermFilter) {
                whereClauses.push("(p.title LIKE ? OR p.city LIKE ? OR p.address LIKE ?)");
                const term = `%${searchTermFilter}%`;
                queryParams.push(term, term, term);
            }
            const whereStatement = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
            const allowedSortColumns = {
                price: "p.price",
                created_at: "p.created_at"
            };
            const sortColumn = allowedSortColumns[getParam(sortBy) ?? "created_at"] ?? "p.created_at";
            const sortDirection = (getParam(order) ?? "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
            const [properties] = await connection_1.default.query(`
        SELECT
          p.*,
          u.name AS broker_name,
          u.phone AS broker_phone,
          u.email AS broker_email,
          GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
        FROM properties p
        LEFT JOIN users u ON p.broker_id = u.id
        LEFT JOIN property_images pi ON p.id = pi.property_id
        ${whereStatement}
        GROUP BY p.id
        ORDER BY ${sortColumn} ${sortDirection}, p.id DESC
        LIMIT ? OFFSET ?
      `, [...queryParams, numericLimit, offset]);
            const [totalResult] = await connection_1.default.query(`
        SELECT COUNT(*) as total
        FROM properties p
        ${whereStatement}
      `, queryParams);
            const processedProperties = properties.map((prop) => ({
                ...prop,
                images: prop.images ? prop.images.split(",") : [],
                price: Number(prop.price)
            }));
            return res.json({
                properties: processedProperties,
                total: totalResult[0]?.total ?? 0,
                page: numericPage,
                totalPages: Math.ceil((totalResult[0]?.total ?? 0) / numericLimit)
            });
        }
        catch (error) {
            console.error("Erro ao listar imoveis:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }
}
exports.propertyController = new PropertyController();
