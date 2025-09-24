import { Request, Response } from "express";
import connection from "../database/connection";
import { uploadToCloudinary } from "../config/cloudinary";
import AuthRequest from "../middlewares/auth";

interface MulterFiles {
  [fieldname: string]: Express.Multer.File[];
}

export interface AuthRequestWithFiles extends AuthRequest {
  files?: MulterFiles;
}

const normalizeStatus = (value: string) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z]/g, "");

class PropertyController {
  async index(req: Request, res: Response) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;

      const { type, purpose, city, minPrice, maxPrice, searchTerm } = req.query;

      const whereClauses: string[] = [];
      const queryParams: (string | number)[] = [];

      if (type) {
        whereClauses.push("type = ?");
        queryParams.push(type as string);
      }
      if (purpose) {
        whereClauses.push("purpose = ?");
        queryParams.push(purpose as string);
      }
      if (city) {
        whereClauses.push("city LIKE ?");
        queryParams.push(`%${city}%`);
      }
      if (minPrice) {
        whereClauses.push("price >= ?");
        queryParams.push(parseFloat(minPrice as string));
      }
      if (maxPrice) {
        whereClauses.push("price <= ?");
        queryParams.push(parseFloat(maxPrice as string));
      }
      if (searchTerm) {
        whereClauses.push("title LIKE ?");
        queryParams.push(`%${searchTerm}%`);
      }

      const whereStatement =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const countQuery = `SELECT COUNT(*) as total FROM properties ${whereStatement}`;
      const [totalResult] = await connection.query(countQuery, queryParams);
      const total = (totalResult as any[])[0].total;

      const dataQuery = `SELECT id, title, type, status, price, address, city, bedrooms, bathrooms, area, garage_spots, has_wifi, broker_id, created_at FROM properties ${whereStatement} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const [data] = await connection.query(dataQuery, [
        ...queryParams,
        limit,
        offset,
      ]);

      return res.json({ data, total });
    } catch (error) {
      console.error("Erro ao listar imóveis:", error);
      return res
        .status(500)
        .json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async show(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const [rows] = await connection.query("SELECT * FROM properties WHERE id = ?", [id]);
      const properties = rows as any[];

      if (properties.length === 0) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }

      return res.status(200).json(properties[0]);
    } catch (error) {
      console.error("Erro ao buscar imóvel:", error);
      return res
        .status(500)
        .json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async create(req: AuthRequestWithFiles, res: Response) {
    try {
      const brokerId = req.userId;
      const {
        title,
        description,
        type,
        purpose,
        price,
        address,
        city,
        state,
        bedrooms,
        bathrooms,
        area,
        garage_spots,
        has_wifi,
      } = req.body;

      const [brokerRows] = (await connection.query(
        "SELECT status FROM brokers WHERE id = ?",
        [brokerId]
      )) as any[];

      if ((brokerRows as any[]).length === 0) {
        return res
          .status(403)
          .json({ error: "Conta de corretor não encontrada para este utilizador." });
      }

      const brokerStatus = normalizeStatus((brokerRows as any[])[0]?.status ?? "");
      const allowedStatuses = new Set([
        "approved",
        "aprovado",
        "verified",
        "verificado",
      ]);

      if (!allowedStatuses.has(brokerStatus)) {
        return res
          .status(403)
          .json({ error: "Apenas corretores aprovados podem criar imóveis." });
      }

      const imageUrls: string[] = [];
      if (req.files && req.files["images"]) {
        for (const file of req.files["images"]) {
          const result = await uploadToCloudinary(file, "properties");
          imageUrls.push(result.url);
        }
      }

      let videoUrl: string | null = null;
      if (req.files && req.files["video"] && req.files["video"][0]) {
        const result = await uploadToCloudinary(req.files["video"][0], "videos");
        videoUrl = result.url;
      }

      const [result] = await connection.query(
        `INSERT INTO properties
           (title, description, type, purpose, price, address, city, state, bedrooms, bathrooms, area,
            garage_spots, has_wifi, broker_id, video_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
          videoUrl,
        ]
      );

      const propertyId = (result as any).insertId;

      if (imageUrls.length > 0) {
        const imageValues = imageUrls.map((url) => [propertyId, url]);
        await connection.query(
          "INSERT INTO property_images (property_id, image_url) VALUES ?",
          [imageValues]
        );
      }

      return res.status(201).json({
        message: "Imóvel criado com sucesso!",
        propertyId,
        images: imageUrls.length,
        video: Boolean(videoUrl),
      });
    } catch (error) {
      console.error("Erro ao criar imóvel:", error);
      return res.status(500).json({ error: "Erro interno do servidor." });
    }
  }

  async update(req: AuthRequest, res: Response) {
  const { id } = req.params;
  const brokerId = req.userId;

  try {
    // 1) Segurança: valida dono
    const [ownerRows] = await connection.query(
      "SELECT broker_id FROM properties WHERE id = ?",
      [id]
    );
    const owners = ownerRows as any[];
    if (owners.length === 0) {
      return res.status(404).json({ error: "Imóvel não encontrado." });
    }
    if (owners[0].broker_id !== brokerId) {
      return res.status(403).json({ error: "Acesso não autorizado a este imóvel." });
    }

    // 2) Campos aceitos em `properties`
    const body = req.body ?? {};
    const allowed: Record<string, any> = {};

    // Só liste aqui colunas que EXISTEM na tabela `properties`
    const allowList = new Set([
      "title",
      "description",
      "type",
      "status",
      "purpose",
      "price",
      "address",
      "city",
      "state",
      "bedrooms",
      "bathrooms",
      "area",
      "garage_spots",
      "has_wifi",
      "video_url",
      // "broker_id" // normalmente você NÃO deve permitir trocar o dono.
    ]);

    for (const key of Object.keys(body)) {
      if (allowList.has(key)) {
        allowed[key] = body[key];
      }
    }

    // Normalizações
    if (allowed.has_wifi !== undefined) {
      allowed.has_wifi = allowed.has_wifi ? 1 : 0; // TiDB/MySQL
    }
    if (allowed.price !== undefined) {
      const n = Number(allowed.price);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ error: "Preço inválido." });
      }
      allowed.price = n;
    }
    ["bedrooms", "bathrooms", "area", "garage_spots"].forEach((k) => {
      if (allowed[k] !== undefined && allowed[k] !== null && allowed[k] !== "") {
        const n = Number(allowed[k]);
        allowed[k] = Number.isFinite(n) ? n : null;
      }
    });

    // 3) Atualiza apenas se houver algo permitido
    if (Object.keys(allowed).length > 0) {
      const setParts: string[] = [];
      const params: any[] = [];
      for (const k of Object.keys(allowed)) {
        setParts.push(`\`${k}\` = ?`);
        params.push(allowed[k]);
      }
      params.push(id);

      const sql = `UPDATE properties SET ${setParts.join(", ")} WHERE id = ?`;
      await connection.query(sql, params);
    }

    // 4) Tratamento de imagens (opcional) — se vierem no corpo como array `images`
    //    Vamos substituir todas as imagens do imóvel (simples e direto).
    if (Array.isArray(body.images)) {
      const images: string[] = body.images.filter((u: any) => typeof u === "string" && u.trim() !== "");
      // apaga todas as atuais
      await connection.query("DELETE FROM property_images WHERE property_id = ?", [id]);
      if (images.length > 0) {
        const values = images.map((url) => [id, url]);
        await connection.query(
          "INSERT INTO property_images (property_id, image_url) VALUES ?",
          [values]
        );
      }
    }

    return res.status(200).json({ message: "Imóvel atualizado com sucesso!" });
  } catch (error) {
    console.error("Erro ao atualizar imóvel:", error);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
}


  async updateStatus(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { status } = req.body as { status?: string };
    const brokerIdFromToken = req.userId;

    if (!status) {
      return res.status(400).json({ error: "O novo status é obrigatório." });
    }

    const normalizedStatus = normalizeStatus(status);
    const statusDictionary: Record<string, string> = {
      disponivel: "Disponível",
      disponível: "Disponível",
      negociando: "Negociando",
      negociação: "Negociando",
      alugado: "Alugado",
      aluguel: "Alugado",
      vendido: "Vendido",
      venda: "Vendido",
    };

    const nextStatus = statusDictionary[normalizedStatus];

    if (!nextStatus) {
      return res.status(400).json({ error: "Status informado é inválido." });
    }

    try {
      const [propertyRows] = await connection.query(
        "SELECT broker_id, price FROM properties WHERE id = ?",
        [id]
      );
      const properties = propertyRows as any[];
      if (properties.length === 0) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }
      const property = properties[0];

      if (property.broker_id !== brokerIdFromToken) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para alterar este imóvel." });
      }

      await connection.query("UPDATE properties SET status = ? WHERE id = ?", [
        nextStatus,
        id,
      ]);

      if (nextStatus === "Vendido") {
        const salePrice = Number(property.price);
        const commissionRate = 5.0;
        const commissionAmount = parseFloat(
          (salePrice * (commissionRate / 100)).toFixed(2)
        );

        const [existingSaleRows] = await connection.query(
          "SELECT id FROM sales WHERE property_id = ?",
          [id]
        );
        const existingSales = existingSaleRows as any[];

        if (existingSales.length > 0) {
          await connection.query(
            "UPDATE sales SET sale_price = ?, commission_rate = ?, commission_amount = ?, sale_date = CURRENT_TIMESTAMP WHERE property_id = ?",
            [salePrice, commissionRate, commissionAmount, id]
          );
        } else {
          await connection.query(
            "INSERT INTO sales (property_id, broker_id, sale_price, commission_rate, commission_amount) VALUES (?, ?, ?, ?, ?)",
            [id, brokerIdFromToken, salePrice, commissionRate, commissionAmount]
          );
        }
      }

      return res
        .status(200)
        .json({
          message: "Status do imóvel atualizado com sucesso!",
          status: nextStatus,
        });
    } catch (error) {
      console.error("Erro ao atualizar status do imóvel:", error);
      return res
        .status(500)
        .json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const brokerIdFromToken = req.userId;

    try {
      const [propertyRows] = await connection.query(
        "SELECT broker_id FROM properties WHERE id = ?",
        [id]
      );
      const properties = propertyRows as any[];
      if (properties.length === 0) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }

      if (properties[0].broker_id !== brokerIdFromToken) {
        return res
          .status(403)
          .json({ error: "Você não tem permissão para deletar este imóvel." });
      }

      await connection.query("DELETE FROM properties WHERE id = ?", [id]);

      return res.status(200).json({ message: "Imóvel deletado com sucesso!" });
    } catch (error) {
      console.error("Erro ao deletar imóvel:", error);
      return res
        .status(500)
        .json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async getAvailableCities(req: Request, res: Response) {
    try {
      const query = `
        SELECT DISTINCT city
        FROM properties
        WHERE city IS NOT NULL AND city != ''
        ORDER BY city ASC
      `;

      const [rows] = await connection.query(query);
      const cities = (rows as any[]).map((row) => row.city);

      return res.status(200).json(cities);
    } catch (error) {
      console.error("Erro ao buscar cidades disponíveis:", error);
      return res
        .status(500)
        .json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async addFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado." });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const [propertyRows] = await connection.query(
        "SELECT id FROM properties WHERE id = ?",
        [propertyId]
      );
      if ((propertyRows as any[]).length === 0) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }

      const [favoriteRows] = await connection.query(
        "SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?",
        [userId, propertyId]
      );

      if ((favoriteRows as any[]).length > 0) {
        return res.status(409).json({ error: "Este imóvel já está nos seus favoritos." });
      }

      await connection.query(
        "INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)",
        [userId, propertyId]
      );

      return res.status(201).json({ message: "Imóvel adicionado aos favoritos." });
    } catch (error) {
      console.error("Erro ao adicionar favorito:", error);
      return res.status(500).json({ error: "Ocorreu um erro no servidor." });
    }
  }

  async removeFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado." });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const [result] = await connection.query(
        "DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?",
        [userId, propertyId]
      );

      if ((result as any).affectedRows === 0) {
        return res.status(404).json({ error: "Favorito não encontrado." });
      }

      return res.status(200).json({ message: "Imóvel removido dos favoritos." });
    } catch (error) {
      console.error("Erro ao remover favorito:", error);
      return res.status(500).json({ error: "Ocorreu um erro no servidor." });
    }
  }

  async listUserFavorites(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Utilizador não autenticado." });
    }

    try {
      const query = `
        SELECT
          p.*,
          ANY_VALUE(u.name)  AS broker_name,
          ANY_VALUE(u.phone) AS broker_phone,
          ANY_VALUE(u.email) AS broker_email,
          GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
          MAX(f.created_at) AS last_fav_at
        FROM favoritos f
        JOIN properties p           ON p.id = f.imovel_id
        LEFT JOIN property_images pi ON pi.property_id = p.id
        LEFT JOIN users u            ON u.id = p.broker_id
        WHERE f.usuario_id = ?
        GROUP BY p.id
        ORDER BY last_fav_at DESC
      `;

      const [rows] = await connection.query(query, [userId]);

      const properties = (rows as any[]).map((prop) => ({
        ...prop,
        images: prop.images ? String(prop.images).split(",") : [],
        price: Number(prop.price),
        has_wifi: Boolean(prop.has_wifi),
        bedrooms: prop.bedrooms != null ? Number(prop.bedrooms) : null,
        bathrooms: prop.bathrooms != null ? Number(prop.bathrooms) : null,
        area: prop.area != null ? Number(prop.area) : null,
        garage_spots: prop.garage_spots != null ? Number(prop.garage_spots) : null,
      }));

      return res.status(200).json(properties);
    } catch (error) {
      console.error("Erro ao listar favoritos:", error);
      return res
        .status(500)
        .json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async listPublicProperties(req: Request, res: Response) {
    try {
      const {
        page = "1",
        limit = "20",
        type,
        purpose,
        city,
        minPrice,
        maxPrice,
        bedrooms,
        sortBy,
        order,
        searchTerm,
        status,
      } = req.query;

      const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const numericPage = Math.max(Number(page) || 1, 1);
      const offset = (numericPage - 1) * numericLimit;

      const whereClauses: string[] = [];
      const queryParams: any[] = [];

      const statusFilter = getParam(status);
      if (statusFilter) {
        whereClauses.push("p.status = ?");
        queryParams.push(statusFilter);
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

      const minPriceValue = Number(getParam(minPrice));
      if (!Number.isNaN(minPriceValue) && minPriceValue > 0) {
        whereClauses.push("p.price >= ?");
        queryParams.push(minPriceValue);
      }

      const maxPriceValue = Number(getParam(maxPrice));
      if (!Number.isNaN(maxPriceValue) && maxPriceValue > 0) {
        whereClauses.push("p.price <= ?");
        queryParams.push(maxPriceValue);
      }

      const bedroomsValue = Number(getParam(bedrooms));
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

      const whereStatement =
        whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const allowedSortColumns: Record<string, string> = {
        price: "p.price",
        created_at: "p.created_at",
      };
      const sortColumn =
        allowedSortColumns[getParam(sortBy) ?? "created_at"] ?? "p.created_at";
      const sortDirection =
        (getParam(order) ?? "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

      const query = `
        SELECT
          p.*,
          ANY_VALUE(u.name)  AS broker_name,
          ANY_VALUE(u.phone) AS broker_phone,
          ANY_VALUE(u.email) AS broker_email,
          GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
        FROM properties p
        LEFT JOIN users u ON p.broker_id = u.id
        LEFT JOIN property_images pi ON p.id = pi.property_id
        ${whereStatement}
        GROUP BY p.id
        ORDER BY ${sortColumn} ${sortDirection}
        LIMIT ? OFFSET ?
      `;

      const [properties] = (await connection.query(query, [
        ...queryParams,
        numericLimit,
        offset,
      ])) as any[];

      const [totalResult] = (await connection.query(
        `SELECT COUNT(DISTINCT p.id) as total FROM properties p ${whereStatement}`,
        queryParams
      )) as any[];

      const processedProperties = (properties as any[]).map((prop: any) => ({
        ...prop,
        images: prop.images ? prop.images.split(",") : [],
        price: Number(prop.price),
        has_wifi: Boolean(prop.has_wifi),
        bedrooms: prop.bedrooms ? Number(prop.bedrooms) : null,
        bathrooms: prop.bathrooms ? Number(prop.bathrooms) : null,
        area: prop.area ? Number(prop.area) : null,
        garage_spots: prop.garage_spots ? Number(prop.garage_spots) : null,
      }));

      return res.json({
        properties: processedProperties,
        total: totalResult[0]?.total ?? 0,
        page: numericPage,
        totalPages: Math.ceil((totalResult[0]?.total ?? 0) / numericLimit),
      });
    } catch (error) {
      console.error("Erro ao listar imóveis:", error);
      return res.status(500).json({ error: "Erro interno do servidor." });
    }
  }
}

// Função auxiliar para extrair o primeiro parâmetro, caso venha como um array
function getParam(value: unknown): string | undefined {
  if (Array.isArray(value) && value.length > 0) {
    return String(value[0]);
  }
  return typeof value === "string" ? value : undefined;
}

export const propertyController = new PropertyController();