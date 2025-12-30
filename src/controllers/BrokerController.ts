import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import connection from "../database/connection";
import { RowDataPacket } from "mysql2";
import AuthRequest from "../middlewares/auth";
import { uploadToCloudinary } from "../config/cloudinary";

class BrokerController {
    async register(req: Request, res: Response) {
        const { name, email, password, creci, phone, address, city, state, agencyId, agency_id } = req.body;
        const resolvedAgencyId = agencyId ?? agency_id ?? null;
        try {
            const [existingUserRows] = await connection.query(
                "SELECT id FROM users WHERE email = ?",
                [email]
            );
            const existingUsers = existingUserRows as any[];

            if (existingUsers.length > 0) {
                return res.status(409).json({ error: "Este email já está em uso." });
            }

            const [existingCreciRows] = await connection.query(
                "SELECT id FROM brokers WHERE creci = ?",
                [creci]
            );
            const existingCreci = existingCreciRows as any[];

            if (existingCreci.length > 0) {
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }

            const passwordHash = await bcrypt.hash(password, 8);
            const [userResult] = await connection.query(
                "INSERT INTO users (name, email, password_hash, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [name, email, passwordHash, phone ?? null, address ?? null, city ?? null, state ?? null]
            );

            const userId = (userResult as any).insertId;

            await connection.query(
                "INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, ?, ?)",
                [userId, creci, "pending_verification", resolvedAgencyId ? Number(resolvedAgencyId) : null]
            );

            return res.status(201).json({ message: "Corretor registrado com sucesso!", brokerId: userId });
        } catch (error) {
            if ((error as any)?.code === "ER_DUP_ENTRY") {
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }
            console.error("Erro no registro do corretor:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }

    async registerWithDocs(req: Request, res: Response) {
        const {
            name,
            email,
            password,
            creci,
            phone,
            address,
            city,
            state,
            agencyId,
            agency_id
        } = req.body;

        const resolvedAgencyId = agencyId ?? agency_id ?? null;

        const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

        if (!name || !email || !password || !creci) {
            return res.status(400).json({ error: "Nome, email, senha e CRECI são obrigatórios." });
        }

        if (!files || !files.creciFront || !files.creciBack || !files.selfie) {
            return res.status(400).json({ error: "Envie as imagens da frente e verso do CRECI e a selfie." });
        }

        const creciFrontFile = files.creciFront[0];
        const creciBackFile = files.creciBack[0];
        const selfieFile = files.selfie[0];

        const db = await connection.getConnection();
        try {
            await db.beginTransaction();

            const [existingUserRows] = await db.query(
                "SELECT id FROM users WHERE email = ?",
                [email]
            );
            const existingUsers = existingUserRows as any[];

            if (existingUsers.length > 0) {
                await db.rollback();
                return res.status(409).json({ error: "Este email já está em uso." });
            }

            const [existingCreciRows] = await db.query(
                "SELECT id FROM brokers WHERE creci = ?",
                [creci]
            );
            const existingCreci = existingCreciRows as any[];

            if (existingCreci.length > 0) {
                await db.rollback();
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }

            const passwordHash = await bcrypt.hash(password, 8);
            const [userResult] = await db.query(
                "INSERT INTO users (name, email, password_hash, phone, address, city, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [name, email, passwordHash, phone ?? null, address ?? null, city ?? null, state ?? null]
            );
            const userId = (userResult as any).insertId;

            await db.query(
                "INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, ?, ?)",
                [userId, creci, "pending_verification", resolvedAgencyId ? Number(resolvedAgencyId) : null]
            );

            const creciFrontResult = await uploadToCloudinary(creciFrontFile, "brokers/documents");
            const creciBackResult = await uploadToCloudinary(creciBackFile, "brokers/documents");
            const selfieResult = await uploadToCloudinary(selfieFile, "brokers/documents");

            const creciFrontUrl = creciFrontResult.url;
            const creciBackUrl = creciBackResult.url;
            const selfieUrl = selfieResult.url;

            await db.query(
                `INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)
                 VALUES (?, ?, ?, ?, 'pending')
                 ON DUPLICATE KEY UPDATE
                   creci_front_url = VALUES(creci_front_url),
                   creci_back_url = VALUES(creci_back_url),
                   selfie_url = VALUES(selfie_url),
                   status = 'pending',
                   updated_at = CURRENT_TIMESTAMP`,
                [userId, creciFrontUrl, creciBackUrl, selfieUrl]
            );

            await db.commit();

            return res.status(201).json({
                message: "Corretor registrado com sucesso! Seus documentos foram enviados para análise.",
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
        } catch (error) {
            await db.rollback();
            if ((error as any)?.code == "ER_DUP_ENTRY") {
                return res.status(409).json({ error: "Este CRECI já está em uso." });
            }
            console.error("Erro no registro com documentos:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        } finally {
            db.release();
        }
    }

    async login(req: Request, res: Response) {
        const { email, password } = req.body;

        try {
            const [userRows] = await connection.query(
                `SELECT
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
                 JOIN brokers b ON u.id = b.id
                 WHERE u.email = ?`,
                [email]
            );

            const users = userRows as any[];
            if (users.length === 0) {
                return res.status(401).json({ error: "Credenciais inválidas." });
            }

            const user = users[0];

            const isPasswordCorrect = await bcrypt.compare(password, user.password_hash);
            if (!isPasswordCorrect) {
                return res.status(401).json({ error: "Credenciais inválidas." });
            }

            const token = jwt.sign(
                { id: user.id, role: "broker" },
                process.env.JWT_SECRET || "default_secret",
                { expiresIn: "1d" }
            );

            const { password_hash, ...userWithoutPassword } = user;

            return res.json({
                broker: {
                    ...userWithoutPassword,
                    role: "broker"
                },
                token
            });
        } catch (error) {
            console.error("Erro no login do corretor:", error);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }
    }

    async getMyProperties(req: AuthRequest, res: Response) {
        const brokerId = req.userId;

        try {
            const page = parseInt(req.query.page as string, 10) || 1;
            const limit = parseInt(req.query.limit as string, 10) || 10;
            const offset = (page - 1) * limit;

            const countQuery = "SELECT COUNT(*) as total FROM properties WHERE broker_id = ?";
            const [totalResult] = await connection.query(countQuery, [brokerId]);
            const total = (totalResult as any[])[0]?.total ?? 0;

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
                    p.id, p.broker_id, p.title, p.description, p.type, p.status, p.purpose, p.price, p.code,
                    p.address, p.quadra, p.lote, p.numero, p.bairro, p.complemento, p.tipo_lote,
                    p.city, p.state, p.bedrooms, p.bathrooms, p.area_construida, p.area_terreno,
                    p.garage_spots, p.has_wifi, p.tem_piscina, p.tem_energia_solar, p.tem_automacao,
                    p.tem_ar_condicionado, p.eh_mobiliada, p.valor_condominio, p.valor_iptu,
                    p.video_url, p.created_at, u.name, u.phone, u.email
                ORDER BY p.created_at DESC
                LIMIT ? OFFSET ?
            `;
            const [dataRows] = await connection.query(dataQuery, [brokerId, limit, offset]);

            const parseBool = (value: unknown) => value === 1 || value === "1" || value === true;

            const properties = (dataRows as any[]).map((row) => ({
                ...row,
                price: Number(row.price),
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
        } catch (error) {
            console.error("Erro ao buscar im�veis do corretor:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }

    async getMyCommissions(req: AuthRequest, res: Response) {
        const brokerId = req.userId;
        try {
            const query = `
                SELECT s.id, p.title, s.sale_price, s.commission_rate, s.commission_amount, s.sale_date 
                FROM sales s
                JOIN properties p ON s.property_id = p.id
                WHERE s.broker_id = ?
                ORDER BY s.sale_date DESC
            `;
            const [commissions] = await connection.query(query, [brokerId]);

            return res.json({
                success: true,
                data: commissions
            });
        } catch (error) {
            console.error("Erro ao buscar comissões:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }

    async getMyPerformanceReport(req: AuthRequest, res: Response) {
        const brokerId = req.userId;
        try {
            const salesQuery = `
                SELECT 
                    COUNT(CASE WHEN status = 'sold' THEN 1 END) as total_sales,
                    SUM(CASE WHEN status = 'sold' THEN commission_value ELSE 0 END) as total_commission
                FROM properties
                WHERE broker_id = ?
            `;
            const [salesResult] = await connection.query<any[]>(salesQuery, [brokerId]);
            const propertiesQuery = `SELECT COUNT(*) as total_properties FROM properties WHERE broker_id = ?`;
            const [propertiesResult] = await connection.query<any[]>(propertiesQuery, [brokerId]);
            
            const statusQuery = `
                SELECT 
                    status,
                    COUNT(*) as count
                FROM properties 
                WHERE broker_id = ? 
                GROUP BY status
            `;
            const [statusRows] = await connection.query<any[]>(statusQuery, [brokerId]);

            const statusBreakdown: { [key: string]: number } = {};
            for (const row of statusRows) {
                statusBreakdown[row.status] = Number(row.count) || 0;
            }

            const report = {
                totalSales: Number(salesResult[0]?.total_sales || 0),
                totalCommission: Number(salesResult[0]?.total_commission || 0),
                totalProperties: Number(propertiesResult[0]?.total_properties || 0),
                statusBreakdown: statusBreakdown
            };

            return res.json({
                success: true,
                data: report
            });
        } catch (error) {
            console.error('Erro ao gerar relatório de desempenho:', error);
            return res.status(500).json({ 
                success: false,
                error: 'Ocorreu um erro inesperado no servidor.' 
            });
        }
    }

    async uploadVerificationDocs(req: AuthRequest, res: Response) {
        const brokerId = req.userId;

        if (!brokerId) {
            return res.status(401).json({
                success: false,
                error: "Corretor não autenticado."
            });
        }

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const creci = (req.body as any)?.creci?.toString().trim() || '';

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

        const creciFrontResult = await uploadToCloudinary(files.creciFront[0], "brokers/documents");
        const creciBackResult = await uploadToCloudinary(files.creciBack[0], "brokers/documents");
        const selfieResult = await uploadToCloudinary(files.selfie[0], "brokers/documents");

        const creciFrontUrl = creciFrontResult.url;
        const creciBackUrl = creciBackResult.url;
        const selfieUrl = selfieResult.url;

        try {
            // Garante que a linha em brokers existe; se não existir, cria com status pending_verification.
            const [brokerRows] = await connection.query<RowDataPacket[]>(
                'SELECT id FROM brokers WHERE id = ?',
                [brokerId]
            );
            if (brokerRows.length === 0) {
                await connection.query(
                    'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
                    [brokerId, creci, 'pending_verification']
                );
            } else {
                await connection.query(
                    'UPDATE brokers SET creci = ? WHERE id = ?',
                    [creci, brokerId]
                );
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

            await connection.query(query, [brokerId, creciFrontUrl, creciBackUrl, selfieUrl]);

            return res.status(201).json({
                success: true,
                message: "Documentos enviados para análise com sucesso!"
            });
        } catch (error) {
            console.error("Erro ao guardar documentos de verificação:", error);
            return res.status(500).json({
                success: false,
                error: "Ocorreu um erro inesperado no servidor."
            });
        }
    }
}

export const brokerController = new BrokerController();












