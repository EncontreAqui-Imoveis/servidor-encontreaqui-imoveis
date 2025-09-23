import { Request, Response } from "express";
import connection from "../database/connection";
import { uploadToCloudinary } from "../config/cloudinary";
import AuthRequest from "../middlewares/auth";
import { RowDataPacket } from "mysql2";

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

      const whereStatement = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

      const countQuery = `SELECT COUNT(*) as total FROM properties ${whereStatement}`;
      const [totalResult] = await connection.query(countQuery, queryParams);
      const total = (totalResult as any[])[0].total;

      const dataQuery = `SELECT id, title, type, status, price, address, city, bedrooms, bathrooms, area, garage_spots, has_wifi, broker_id, created_at FROM properties ${whereStatement} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
      const [data] = await connection.query(dataQuery, [...queryParams, limit, offset]);

      return res.json({ data, total });
    } catch (error) {
      console.error("Erro ao listar imoveis:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async show(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const [rows] = await connection.query("SELECT * FROM properties WHERE id = ?", [id]);
      const properties = rows as any[];

      if (properties.length === 0) {
        return res.status(404).json({ error: "Imovel nao encontrado." });
      }

      return res.status(200).json(properties[0]);
    } catch (error) {
      console.error("Erro ao buscar imovel:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
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
        has_wifi
      } = req.body;

      const [brokerRows] = await connection.query(
        "SELECT status FROM brokers WHERE id = ?",
        [brokerId]
      ) as any[];

      if (brokerRows.length === 0) {
        return res.status(403).json({ error: "Conta de corretor nao encontrada para este utilizador." });
      }

      const brokerStatus = normalizeStatus((brokerRows as any[])[0]?.status ?? "");
      const allowedStatuses = new Set(["approved", "aprovado", "verified", "verificado"]);

      if (!allowedStatuses.has(brokerStatus)) {
        return res.status(403).json({ error: "Apenas corretores aprovados podem criar imoveis." });
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
          videoUrl
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
        message: "Imovel criado com sucesso!",
        propertyId,
        images: imageUrls.length,
        video: Boolean(videoUrl)
      });
    } catch (error) {
      console.error("Erro ao criar imovel:", error);
      return res.status(500).json({ error: "Erro interno do servidor." });
    }
  }

  async update(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const {
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
      area
    } = req.body;
    const brokerIdFromToken = req.userId;

    try {
      const [propertyRows] = await connection.query("SELECT broker_id FROM properties WHERE id = ?", [id]);
      const properties = propertyRows as any[];
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

      await connection.query(updateQuery, [
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
    } catch (error) {
      console.error("Erro ao atualizar imovel:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { status } = req.body as { status?: string };
    const brokerIdFromToken = req.userId;

    if (!status) {
      return res.status(400).json({ error: "O novo status e obrigatorio." });
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
      venda: "Vendido"
    };

    const nextStatus = statusDictionary[normalizedStatus];

    if (!nextStatus) {
      return res.status(400).json({ error: "Status informado e invalido." });
    }

    try {
      const [propertyRows] = await connection.query("SELECT broker_id, price FROM properties WHERE id = ?", [id]);
      const properties = propertyRows as any[];
      if (properties.length === 0) {
        return res.status(404).json({ error: "Imovel nao encontrado." });
      }
      const property = properties[0];

      if (property.broker_id !== brokerIdFromToken) {
        return res.status(403).json({ error: "Voce nao tem permissao para alterar este imovel." });
      }

      await connection.query("UPDATE properties SET status = ? WHERE id = ?", [nextStatus, id]);

      if (nextStatus === "Vendido") {
        const salePrice = Number(property.price);
        const commissionRate = 5.0;
        const commissionAmount = parseFloat((salePrice * (commissionRate / 100)).toFixed(2));

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

      return res.status(200).json({ message: "Status do imovel atualizado com sucesso!", status: nextStatus });
    } catch (error) {
      console.error("Erro ao atualizar status do imovel:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const brokerIdFromToken = req.userId;

    try {
      const [propertyRows] = await connection.query("SELECT broker_id FROM properties WHERE id = ?", [id]);
      const properties = propertyRows as any[];
      if (properties.length === 0) {
        return res.status(404).json({ error: "Imovel nao encontrado." });
      }

      if (properties[0].broker_id !== brokerIdFromToken) {
        return res.status(403).json({ error: "Voce nao tem permissao para deletar este imovel." });
      }

      await connection.query("DELETE FROM properties WHERE id = ?", [id]);

      return res.status(200).json({ message: "Imovel deletado com sucesso!" });
    } catch (error) {
      console.error("Erro ao deletar imovel:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
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
      console.error("Erro ao buscar cidades disponiveis:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async addFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "Usuario nao autenticado." });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imovel invalido." });
    }

    try {
      const [propertyRows] = await connection.query("SELECT id FROM properties WHERE id = ?", [propertyId]);
      if ((propertyRows as any[]).length === 0) {
        return res.status(404).json({ error: "Imovel nao encontrado." });
      }

      const [favoriteRows] = await connection.query(
        "SELECT 1 FROM favoritos WHERE usuario_id = ? AND imovel_id = ?",
        [userId, propertyId]
      );

      if ((favoriteRows as any[]).length > 0) {
        return res.status(409).json({ error: "Este imovel ja esta nos seus favoritos." });
      }

      await connection.query(
        "INSERT INTO favoritos (usuario_id, imovel_id) VALUES (?, ?)",
        [userId, propertyId]
      );

      return res.status(201).json({ message: "Imovel adicionado aos favoritos." });
    } catch (error) {
      console.error("Erro ao adicionar favorito:", error);
      return res.status(500).json({ error: "Ocorreu um erro no servidor." });
    }
  }

  async removeFavorite(req: AuthRequest, res: Response) {
    const userId = req.userId;
    const propertyId = Number.parseInt(req.params.id, 10);

    if (!userId) {
      return res.status(401).json({ error: "Usuario nao autenticado." });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imovel invalido." });
    }

    try {
      const [result] = await connection.query(
        "DELETE FROM favoritos WHERE usuario_id = ? AND imovel_id = ?",
        [userId, propertyId]
      );

      if ((result as any).affectedRows === 0) {
        return res.status(404).json({ error: "Favorito nao encontrado." });
      }

      return res.status(200).json({ message: "Imovel removido dos favoritos." });
    } catch (error) {
      console.error("Erro ao remover favorito:", error);
      return res.status(500).json({ error: "Ocorreu um erro no servidor." });
    }
  }

  async listUserFavorites(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Utilizador não autenticado.' });
    }

    try {
      // CORREÇÃO: Adicionada a função ANY_VALUE() para compatibilidade com o sql_mode=only_full_group_by.
      // Isto resolve o erro ER_WRONG_FIELD_WITH_GROUP sem alterar o resultado da query.
      const query = `
        SELECT
          p.*,
          GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images,
          ANY_VALUE(u.name) AS broker_name,
          ANY_VALUE(u.phone) AS broker_phone,
          ANY_VALUE(u.email) AS broker_email
        FROM favoritos f
        JOIN properties p ON p.id = f.imovel_id
        LEFT JOIN property_images pi ON pi.property_id = p.id
        LEFT JOIN users u ON u.id = p.broker_id
        WHERE f.usuario_id = ?
        GROUP BY p.id
        ORDER BY f.created_at DESC
      `;
      
      const [rows] = await connection.query(query, [userId]);

      // Processa a string de imagens para a transformar num array
      const properties = (rows as any[]).map(prop => ({
        ...prop,
        images: prop.images ? prop.images.split(',') : [],
      }));

      return res.status(200).json(properties);
    } catch (error) {
      console.error('Erro ao listar favoritos:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
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
      status
    } = req.query;

    const getParam = (value: unknown): string | undefined => {
      if (Array.isArray(value) && value.length > 0) {
        return typeof value[0] === "string" ? (value[0] as string) : undefined;
      }
      return typeof value === "string" ? (value as string) : undefined;
    };

    const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const numericPage = Math.max(Number(page) || 1, 1);
    const offset = (numericPage - 1) * numericLimit;

    const whereClauses: string[] = [];
    const queryParams: any[] = [];

    // ✅ CORREÇÃO: Remover filtro padrão de status "Disponível"
    const statusFilter = getParam(status);
    if (statusFilter) {
      whereClauses.push("p.status = ?");
      queryParams.push(statusFilter);
    }
    // ❌ REMOVIDO: else que filtrava apenas "Disponível"

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

    const allowedSortColumns: Record<string, string> = {
      price: "p.price",
      created_at: "p.created_at",
      title: "p.title"
    };
    const sortColumn = allowedSortColumns[getParam(sortBy) ?? "created_at"] ?? "p.created_at";
    const sortDirection = (getParam(order) ?? "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [properties] = await connection.query(
            `
            SELECT
                p.id, p.title, p.description, p.type, p.status, p.purpose, p.price, 
                p.address, p.city, p.state, p.bedrooms, p.bathrooms, p.area, 
                p.garage_spots, p.has_wifi, p.broker_id, p.created_at, p.updated_at,
                p.video_url, p.code,
                u.name AS broker_name,
                u.phone AS broker_phone,
                u.email AS broker_email,
                COALESCE(GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id SEPARATOR ','), '') AS images
            FROM properties p
            LEFT JOIN users u ON p.broker_id = u.id
            LEFT JOIN property_images pi ON p.id = pi.property_id
            ${whereStatement}
            GROUP BY 
                p.id, p.title, p.description, p.type, p.status, p.purpose, p.price, 
                p.address, p.city, p.state, p.bedrooms, p.bathrooms, p.area, 
                p.garage_spots, p.has_wifi, p.broker_id, p.created_at, p.updated_at,
                p.video_url, p.code, u.name, u.phone, u.email
            ORDER BY ${sortColumn} ${sortDirection}, p.id DESC
            LIMIT ? OFFSET ?
            `,
            [...queryParams, numericLimit, offset]
        ) as any[];


    const [totalResult] = await connection.query(
      `
      SELECT COUNT(DISTINCT p.id) as total
      FROM properties p
      ${whereStatement}
      `,
      queryParams
    ) as any[];

    // ✅ CORREÇÃO: Processamento mais robusto das imagens
    const processedProperties = properties.map((prop: any) => ({
      ...prop,
      images: prop.images && prop.images.trim() !== '' 
        ? prop.images.split(',').filter((url: string) => url.trim() !== '')
        : [],
      price: Number(prop.price),
      has_wifi: Boolean(prop.has_wifi),
      bedrooms: prop.bedrooms ? Number(prop.bedrooms) : null,
      bathrooms: prop.bathrooms ? Number(prop.bathrooms) : null,
      area: prop.area ? Number(prop.area) : null,
      garage_spots: prop.garage_spots ? Number(prop.garage_spots) : null
    }));

    return res.json({
      properties: processedProperties,
      total: totalResult[0]?.total ?? 0,
      page: numericPage,
      totalPages: Math.ceil((totalResult[0]?.total ?? 0) / numericLimit)
    });
  } catch (error) {
    console.error("Erro ao listar imoveis:", error);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }

async function updateFeaturedImage(req: AuthRequest, res: Response) {
  const { propertyId } = req.params;
  const { featuredImageIndex } = req.body;
  const brokerIdFromToken = req.userId;

  // validação básica de entrada
  if (
    featuredImageIndex === undefined ||
    Number.isNaN(Number(featuredImageIndex))
  ) {
    return res.status(400).json({ error: "featuredImageIndex inválido." });
  }

  try {
    // 1) Verificar permissões
    const [propertyRows] = await connection.query<RowDataPacket[]>(
      "SELECT broker_id FROM properties WHERE id = ?",
      [propertyId]
    );

    if (propertyRows.length === 0) {
      return res.status(404).json({ error: "Imóvel não encontrado." });
    }

    if (propertyRows[0].broker_id !== brokerIdFromToken) {
      return res.status(403).json({ error: "Sem permissão." });
    }

    // 2) Obter todas as imagens do imóvel (em ordem de id)
    const [imageRows] = await connection.query<RowDataPacket[]>(
      "SELECT id, image_url FROM property_images WHERE property_id = ? ORDER BY id",
      [propertyId]
    );

    if (imageRows.length === 0) {
      return res.status(404).json({ error: "Nenhuma imagem encontrada." });
    }

    const images = imageRows.map(r => r.image_url);
    const idx = Number(featuredImageIndex);

    if (idx < 0 || idx >= images.length) {
      return res.status(400).json({ error: "featuredImageIndex fora do intervalo." });
    }

    // 3) Reordenar array - colocar a imagem selecionada primeiro
    const selectedImage = images[idx];
    const newOrder = [selectedImage, ...images.filter((_, i) => i !== idx)];

    // 3.1) [Opcional] Persistir ordem no banco se você tiver uma coluna `position`
    // try {
    //   await connection.beginTransaction();
    //   // Monte um CASE que define position começando em 1 (destacada) e segue a ordem do array
    //   const idByUrl = new Map<string, number>();
    //   imageRows.forEach(r => idByUrl.set(r.image_url, r.id));
    //
    //   const idsInNewOrder = newOrder.map(url => idByUrl.get(url)!);
    //   const cases = idsInNewOrder
    //     .map((id, i) => `WHEN ${id} THEN ${i + 1}`)
    //     .join(" ");
    //
    //   await connection.query(
    //     `
    //     UPDATE property_images
    //     SET position = CASE id
    //       ${cases}
    //       ELSE position
    //     END
    //     WHERE property_id = ?
    //     `,
    //     [propertyId]
    //   );
    //
    //   await connection.commit();
    // } catch (e) {
    //   await connection.rollback();
    //   console.error("Falha ao persistir posição das imagens:", e);
    //   // não interrompe a resposta — apenas loga
    // }

    // 4) Buscar o imóvel “enriquecido” (sua query adaptada para um único imóvel)
    const [properties] = await connection.query<RowDataPacket[]>(
            `
            SELECT
                p.id, p.title, p.description, p.type, p.status, p.purpose, p.price, 
                p.address, p.city, p.state, p.bedrooms, p.bathrooms, p.area, 
                p.garage_spots, p.has_wifi, p.broker_id, p.created_at, p.updated_at,
                p.video_url,
                u.name AS broker_name,
                u.phone AS broker_phone,
                u.email AS broker_email,
                COALESCE(GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id SEPARATOR ','), '') AS images
            FROM properties p
            LEFT JOIN users u ON p.broker_id = u.id
            LEFT JOIN property_images pi ON p.id = pi.property_id
            WHERE p.id = ?
            GROUP BY 
                p.id, p.title, p.description, p.type, p.status, p.purpose, p.price, 
                p.address, p.city, p.state, p.bedrooms, p.bathrooms, p.area, 
                p.garage_spots, p.has_wifi, p.broker_id, p.created_at, p.updated_at,
                p.video_url, u.name, u.phone, u.email
            `,
            [propertyId]
        );


    // Garantir array
    const propertiesArray: any[] = Array.isArray(properties) ? (properties as any[]) : [];

    // total aqui é 1 ou 0 (já validado acima), mas mantém a estrutura
    const total = propertiesArray.length;

    // Processar tipos + normalizar imagens
    const processedProperties = propertiesArray.map((prop: any) => ({
      ...prop,
      images:
        prop.images && String(prop.images).trim() !== ""
          ? String(prop.images)
              .split(",")
              .map((url: string) => url.trim())
              .filter((url: string) => url !== "")
          : [],
      price: prop.price != null ? Number(prop.price) : null,
      has_wifi: Boolean(prop.has_wifi),
      bedrooms: prop.bedrooms != null ? Number(prop.bedrooms) : null,
      bathrooms: prop.bathrooms != null ? Number(prop.bathrooms) : null,
      area: prop.area != null ? Number(prop.area) : null,
      garage_spots: prop.garage_spots != null ? Number(prop.garage_spots) : null,
      video_url: prop.video_url || null
    }));

    if (processedProperties[0]) {
      const imgs: string[] = processedProperties[0].images || [];
      const reordered = [selectedImage, ...imgs.filter(u => u !== selectedImage)];
      processedProperties[0].images = reordered;
    }

    return res.json({
      success: true,
      featuredImage: selectedImage,
      newImageOrder: newOrder, // conveniência pro frontend
      property: processedProperties[0] || null,
      total
    });
  } catch (error) {
    console.error("Erro ao atualizar imagem destaque:", error);
    return res.status(500).json({ error: "Erro interno do servidor." });
  }
}
}
}
export const propertyController = new PropertyController();

