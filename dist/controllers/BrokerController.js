"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.brokerController = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const connection_1 = __importDefault(require("../database/connection"));
class BrokerController {
    async register(req, res) {
        const { name, email, password, creci, phone, address, city, state } = req.body;
        try {
            const [existingUserRows] = await connection_1.default.query("SELECT id FROM users WHERE email = ?", [email]);
            const existingUsers = existingUserRows;
            if (existingUsers.length > 0) {
                return res.status(409).json({ error: "Este email ja esta em uso." });
            }
            const [existingCreciRows] = await connection_1.default.query("SELECT id FROM brokers WHERE creci = ?", [creci]);
            const existingCreci = existingCreciRows;
            if (existingCreci.length > 0) {
                return res.status(409).json({ error: "Este CRECI ja esta em uso." });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            const [userResult] = await connection_1.default.query("INSERT INTO users (name, email, password_hash, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)", [name, email, passwordHash, phone ?? null, address ?? null, city ?? null, state ?? null]);
            const userId = userResult.insertId;
            await connection_1.default.query("INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)", [userId, creci, "pending_verification"]);
            return res.status(201).json({ message: "Corretor registrado com sucesso!", brokerId: userId });
        }
        catch (error) {
            if (error?.code === "ER_DUP_ENTRY") {
                return res.status(409).json({ error: "Este CRECI ja esta em uso." });
            }
            console.error("Erro no registro do corretor:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }
    async registerWithDocs(req, res) {
        const { name, email, password, creci, phone, address, city, state } = req.body;
        const files = req.files;
        if (!name || !email || !password || !creci) {
            return res.status(400).json({ error: "Nome, email, senha e CRECI sao obrigatorios." });
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
                return res.status(409).json({ error: "Este email ja esta em uso." });
            }
            const [existingCreciRows] = await db.query("SELECT id FROM brokers WHERE creci = ?", [creci]);
            const existingCreci = existingCreciRows;
            if (existingCreci.length > 0) {
                await db.rollback();
                return res.status(409).json({ error: "Este CRECI ja esta em uso." });
            }
            const passwordHash = await bcryptjs_1.default.hash(password, 8);
            const [userResult] = await db.query("INSERT INTO users (name, email, password_hash, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)", [name, email, passwordHash, phone ?? null, address ?? null, city ?? null, state ?? null]);
            const userId = userResult.insertId;
            await db.query("INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)", [userId, creci, "pending_verification"]);
            const creciFrontUrl = `/uploads/docs/${creciFrontFile.filename}`;
            const creciBackUrl = `/uploads/docs/${creciBackFile.filename}`;
            const selfieUrl = `/uploads/docs/${selfieFile.filename}`;
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
                message: "Corretor registrado com sucesso! Seus documentos foram enviados para analise.",
                broker: {
                    id: userId,
                    name,
                    email,
                    phone: phone ?? null,
                    address: address ?? null,
                    city: city ?? null,
                    state: state ?? null,
                    status: "pending_verification"
                }
            });
        }
        catch (error) {
            await db.rollback();
            if (error?.code == "ER_DUP_ENTRY") {
                return res.status(409).json({ error: "Este CRECI ja esta em uso." });
            }
            console.error("Erro no registro com documentos:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
        finally {
            db.release();
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
           u.address,
           u.city,
           u.state,
           b.creci,
           b.status AS broker_status
         FROM users u
         LEFT JOIN brokers b ON u.id = b.id
         WHERE u.email = ?`, [email]);
            const users = userRows;
            if (users.length === 0) {
                return res.status(401).json({ error: "Credenciais invalidas." });
            }
            const user = users[0];
            if (!user.creci) {
                return res.status(401).json({ error: "Este usuario nao e um corretor." });
            }
            const isPasswordCorrect = await bcryptjs_1.default.compare(password, user.password_hash);
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: "Credenciais invalidas." });
            }
            const token = jsonwebtoken_1.default.sign({ id: user.id, role: "broker" }, process.env.JWT_SECRET || "default_secret", { expiresIn: "1d" });
            const { password_hash, broker_status, ...userWithoutPassword } = user;
            return res.json({
                broker: {
                    ...userWithoutPassword,
                    status: broker_status,
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
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const offset = (page - 1) * limit;
            const countQuery = "SELECT COUNT(*) as total FROM properties WHERE broker_id = ?";
            const [totalResult] = await connection_1.default.query(countQuery, [brokerId]);
            const total = totalResult[0]?.total ?? 0;
            const dataQuery = `
        SELECT
          p.*, 
          GROUP_CONCAT(pi.image_url) AS images
        FROM properties p
        LEFT JOIN property_images pi ON p.id = pi.property_id
        WHERE p.broker_id = ?
        GROUP BY p.id
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `;
            const [dataRows] = await connection_1.default.query(dataQuery, [brokerId, limit, offset]);
            const properties = dataRows.map((row) => ({
                ...row,
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
            console.error("Erro ao buscar imoveis do corretor:", error);
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
        SELECT s.id, p.title, s.sale_price, s.commission_rate, s.commission_amount, s.sale_date 
        FROM sales s
        JOIN properties p ON s.property_id = p.id
        WHERE s.broker_id = ?
        ORDER BY s.sale_date DESC
      `;
            const [commissions] = await connection_1.default.query(query, [brokerId]);
            return res.json({
                success: true,
                data: commissions
            });
        }
        catch (error) {
            console.error("Erro ao buscar comissoes:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
    async getMyPerformanceReport(req, res) {
        const brokerId = req.userId;
        try {
            const salesQuery = `
        SELECT COUNT(*) as total_sales, SUM(commission_amount) as total_commission
        FROM sales
        WHERE broker_id = ?
      `;
            const [salesResult] = await connection_1.default.query(salesQuery, [brokerId]);
            const statusQuery = `
        SELECT status, COUNT(*) as total
        FROM properties
        WHERE broker_id = ?
        GROUP BY status
      `;
            const [statusRows] = await connection_1.default.query(statusQuery, [brokerId]);
            const statusBreakdown = {
                disponivel: 0,
                negociando: 0,
                alugado: 0,
                vendido: 0
            };
            const normalize = (value) => value
                .toString()
                .trim()
                .toLowerCase()
                .normalize("NFD")
                .replace(/[^a-z]/g, "");
            for (const row of statusRows) {
                const normalizedStatus = normalize(row.status ?? "");
                const count = Number(row.total) || 0;
                if (normalizedStatus === "disponivel") {
                    statusBreakdown.disponivel += count;
                }
                else if (normalizedStatus === "negociando" || normalizedStatus === "negociacao") {
                    statusBreakdown.negociando += count;
                }
                else if (normalizedStatus === "alugado" || normalizedStatus === "aluguel") {
                    statusBreakdown.alugado += count;
                }
                else if (normalizedStatus === "vendido" || normalizedStatus === "venda") {
                    statusBreakdown.vendido += count;
                }
            }
            const totalProperties = Object.values(statusBreakdown).reduce((acc, value) => acc + value, 0);
            const totalSales = salesResult[0]?.total_sales || 0;
            const totalCommission = salesResult[0]?.total_commission || 0;
            const report = {
                totalSales,
                totalCommission,
                totalProperties,
                statusBreakdown
            };
            return res.json({
                success: true,
                data: report
            });
        }
        catch (error) {
            console.error("Erro ao gerar relatorio de desempenho:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
    async uploadVerificationDocs(req, res) {
        const brokerId = req.userId;
        if (!brokerId) {
            return res.status(401).json({
                success: false,
                error: "Corretor nao autenticado."
            });
        }
        const files = req.files;
        if (!files.creciFront || !files.creciBack || !files.selfie) {
            return res.status(400).json({
                success: false,
                error: "E necessario enviar os tres ficheiros."
            });
        }
        const creciFrontUrl = `/uploads/docs/${files.creciFront[0].filename}`;
        const creciBackUrl = `/uploads/docs/${files.creciBack[0].filename}`;
        const selfieUrl = `/uploads/docs/${files.selfie[0].filename}`;
        try {
            const query = `
        INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          creci_front_url = VALUES(creci_front_url),
          creci_back_url = VALUES(creci_back_url),
          selfie_url = VALUES(selfie_url),
          status = 'pending';
      `;
            await connection_1.default.query(query, [brokerId, creciFrontUrl, creciBackUrl, selfieUrl]);
            return res.status(201).json({
                success: true,
                message: "Documentos enviados para analise com sucesso!"
            });
        }
        catch (error) {
            console.error("Erro ao guardar documentos de verificacao:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
    async saveDocumentUrls(req, res) {
        const brokerId = req.userId;
        const { creciFrontUrl, creciBackUrl, selfieUrl } = req.body;
        if (!brokerId) {
            return res.status(401).json({
                success: false,
                error: "Corretor nao autenticado."
            });
        }
        try {
            const query = `
        INSERT INTO broker_documents
          (broker_id, creci_front_url, creci_back_url, selfie_url, status)
        VALUES (?, ?, ?, ?, 'pending')
        ON DUPLICATE KEY UPDATE
          creci_front_url = VALUES(creci_front_url),
          creci_back_url = VALUES(creci_back_url),
          selfie_url = VALUES(selfie_url),
          status = 'pending',
          updated_at = CURRENT_TIMESTAMP
      `;
            await connection_1.default.query(query, [brokerId, creciFrontUrl, creciBackUrl, selfieUrl]);
            return res.status(200).json({
                success: true,
                message: "URLs dos documentos salvas com sucesso!"
            });
        }
        catch (error) {
            console.error("Erro ao salvar URLs dos documentos:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
}
exports.brokerController = new BrokerController();
