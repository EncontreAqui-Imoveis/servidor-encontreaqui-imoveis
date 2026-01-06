import { Request, Response } from "express";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import connection from "../database/connection";
import { uploadToCloudinary } from "../config/cloudinary";
import AuthRequest from "../middlewares/auth";
import { notifyAdmins } from "../services/notificationService";
import { notifyPriceDropIfNeeded } from "../services/priceDropNotificationService";

interface MulterFiles {
  [fieldname: string]: Express.Multer.File[];
}

export interface AuthRequestWithFiles extends AuthRequest {
  files?: MulterFiles;
}
type PropertyStatus = "pending_approval" | "approved" | "rejected" | "rented" | "sold";
type DealType = "sale" | "rent";
type RecurrenceInterval = "none" | "weekly" | "monthly" | "yearly";

type Nullable<T> = T | null;

const STATUS_MAP: Record<string, PropertyStatus> = {
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

const ALLOWED_STATUSES = new Set<PropertyStatus>([
  "pending_approval",
  "approved",
  "rejected",
  "rented",
  "sold",
]);

const NOTIFY_ON_STATUS: Set<PropertyStatus> = new Set(["sold", "rented"]);

const DEAL_TYPE_MAP: Record<string, DealType> = {
  sale: "sale",
  sold: "sale",
  venda: "sale",
  vendido: "sale",
  vendida: "sale",
  rent: "rent",
  rented: "rent",
  aluguel: "rent",
  alugado: "rent",
  alugada: "rent",
  locacao: "rent",
  locado: "rent",
  locada: "rent",
};

const STATUS_TO_DEAL: Partial<Record<PropertyStatus, DealType>> = {
  sold: "sale",
  rented: "rent",
};

const PURPOSE_MAP: Record<string, string> = {
  venda: "Venda",
  comprar: "Venda",
  aluguel: "Aluguel",
  alugar: "Aluguel",
  vendaealuguel: "Venda e Aluguel",
  vendaaluguel: "Venda e Aluguel",
};

const ALLOWED_PURPOSES = new Set(["Venda", "Aluguel", "Venda e Aluguel"]);

const RECURRENCE_INTERVALS = new Set<RecurrenceInterval>([
  "none",
  "weekly",
  "monthly",
  "yearly",
]);

interface PropertyRow extends RowDataPacket {
  id: number;
  broker_id: number;
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_email?: string | null;
  title: string;
  description: string;
  type: string;
  purpose: string;
  status: PropertyStatus;
  price: number | string;
  price_sale?: number | string | null;
  price_rent?: number | string | null;
  code?: string | null;
  address: string;
  quadra?: string | null;
  lote?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  tipo_lote?: string | null;
  city: string;
  state: string;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_construida?: number | string | null;
  area_terreno?: number | string | null;
  garage_spots?: number | null;
  has_wifi?: number | boolean | null;
  tem_piscina?: number | boolean | null;
  tem_energia_solar?: number | boolean | null;
  tem_automacao?: number | boolean | null;
  tem_ar_condicionado?: number | boolean | null;
  eh_mobiliada?: number | boolean | null;
  valor_condominio?: number | string | null;
  valor_iptu?: number | string | null;
  sale_value?: number | string | null;
  commission_rate?: number | string | null;
  commission_value?: number | string | null;
  video_url?: string | null;
  created_at?: Date;
  updated_at?: Date;
  images?: string | null;
  agency_id?: number | null;
  agency_name?: string | null;
  agency_logo_url?: string | null;
  agency_address?: string | null;
  agency_city?: string | null;
  agency_state?: string | null;
  agency_phone?: string | null;
}

interface PropertyAggregateRow extends PropertyRow {
  images?: string | null;
}

function normalizeStatus(value: unknown): Nullable<PropertyStatus> {
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


function normalizePurpose(value: unknown): Nullable<string> {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .normalize("NFD")
    .replace(/[^\p{L}0-9]/gu, "")
    .toLowerCase();
  const mapped = PURPOSE_MAP[normalized];
  if (!mapped || !ALLOWED_PURPOSES.has(mapped)) {
    return null;
  }
  return mapped;
}

function purposeAllowsDeal(purpose: string, dealType: DealType): boolean {
  const normalized = normalizePurpose(purpose) ?? purpose;
  const lower = normalized.toLowerCase();
  if (dealType === "sale") {
    return lower.includes("vend");
  }
  return lower.includes("alug");
}

function parseOptionalPrice(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parsePrice(value);
}

function parsePrice(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Preço inválido.");
  }
  return parsed;
}

function normalizeDealType(value: unknown): Nullable<DealType> {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .normalize("NFD")
    .replace(/[^\p{L}0-9]/gu, "")
    .toLowerCase();
  return DEAL_TYPE_MAP[normalized] ?? null;
}

function resolveDealTypeFromStatus(status: Nullable<PropertyStatus>): Nullable<DealType> {
  if (!status) return null;
  return STATUS_TO_DEAL[status] ?? null;
}

function normalizeRecurrenceInterval(
  value: unknown
): Nullable<RecurrenceInterval> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase() as RecurrenceInterval;
  return RECURRENCE_INTERVALS.has(normalized) ? normalized : null;
}

function resolveDealAmount(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return parsePrice(value);
}

function calculateCommissionAmount(amount: number, rate: number): number {
  return Number((amount * (rate / 100)).toFixed(2));
}

function parseDecimal(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Valor numérico inválido.");
  }
  return parsed;
}

function parseInteger(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Valor inteiro inválido.");
  }
  return Math.trunc(parsed);
}

function parseBoolean(value: unknown): 0 | 1 {
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

function stringOrNull(value: unknown): Nullable<string> {
  if (value === undefined || value === null) {
    return null;
  }
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function toBoolean(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

function mapProperty(row: PropertyAggregateRow) {
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
    price_sale: row.price_sale != null ? Number(row.price_sale) : null,
    price_rent: row.price_rent != null ? Number(row.price_rent) : null,
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
    area_construida:
      row.area_construida != null ? Number(row.area_construida) : null,
    area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
    garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
    has_wifi: toBoolean(row.has_wifi),
    tem_piscina: toBoolean(row.tem_piscina),
    tem_energia_solar: toBoolean(row.tem_energia_solar),
    tem_automacao: toBoolean(row.tem_automacao),
    tem_ar_condicionado: toBoolean(row.tem_ar_condicionado),
    eh_mobiliada: toBoolean(row.eh_mobiliada),
    valor_condominio:
      row.valor_condominio != null ? Number(row.valor_condominio) : null,
    valor_iptu: row.valor_iptu != null ? Number(row.valor_iptu) : null,
    video_url: row.video_url ?? null,
    images,
    agency,
    broker_name: row.broker_name ?? null,
    broker_phone: row.broker_phone ?? null,
    broker_email: row.broker_email ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type QueryExecutor = Pick<typeof connection, "query">;

async function upsertSaleRecord(
  db: QueryExecutor,
  payload: {
    propertyId: number;
    brokerId: number;
    dealType: DealType;
    salePrice: number;
    commissionRate: number;
    commissionAmount: number;
    iptuValue: number | null;
    condominioValue: number | null;
    isRecurring: number;
    commissionCycles: number;
    recurrenceInterval: RecurrenceInterval;
  }
) {
  const {
    propertyId,
    brokerId,
    dealType,
    salePrice,
    commissionRate,
    commissionAmount,
    iptuValue,
    condominioValue,
    isRecurring,
    commissionCycles,
    recurrenceInterval,
  } = payload;

  const [existingSaleRows] = await db.query<RowDataPacket[]>(
    "SELECT id FROM sales WHERE property_id = ? ORDER BY sale_date DESC LIMIT 1",
    [propertyId]
  );

  if (existingSaleRows.length > 0) {
    await db.query(
      `UPDATE sales
         SET deal_type = ?,
             sale_price = ?,
             commission_rate = ?,
             commission_amount = ?,
             iptu_value = ?,
             condominio_value = ?,
             is_recurring = ?,
             commission_cycles = ?,
             recurrence_interval = ?,
             sale_date = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        dealType,
        salePrice,
        commissionRate,
        commissionAmount,
        iptuValue,
        condominioValue,
        isRecurring,
        commissionCycles,
        recurrenceInterval,
        existingSaleRows[0].id,
      ]
    );
    return;
  }

  await db.query(
    `INSERT INTO sales
       (property_id, broker_id, deal_type, sale_price, commission_rate, commission_amount, iptu_value, condominio_value, is_recurring, commission_cycles, recurrence_interval)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      propertyId,
      brokerId,
      dealType,
      salePrice,
      commissionRate,
      commissionAmount,
      iptuValue,
      condominioValue,
      isRecurring,
      commissionCycles,
      recurrenceInterval,
    ]
  );
}

class PropertyController {
  async show(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const [rows] = await connection.query<PropertyAggregateRow[]>(
        `
          SELECT
            p.*,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            ANY_VALUE(u.name) AS broker_name,
            ANY_VALUE(u.phone) AS broker_phone,
            ANY_VALUE(u.email) AS broker_email,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE p.id = ?
          GROUP BY p.id
        `,
        [propertyId]
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }

      return res.status(200).json(mapProperty(rows[0]));
    } catch (error) {
      console.error("Erro ao buscar imóvel:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async create(req: AuthRequestWithFiles, res: Response) {
    const brokerId = req.userId;

    if (!brokerId) {
      return res.status(401).json({ error: "Corretor não autenticado." });
    }

    const {
      title,
      description,
      type,
      purpose,
      price,
      price_sale,
      price_rent,
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
      area,
      garage_spots,
      has_wifi,
      tem_piscina,
      tem_energia_solar,
      tem_automacao,
      tem_ar_condicionado,
      eh_mobiliada,
      valor_condominio,
      valor_iptu,
    } = req.body ?? {};

    if (!title || !description || !type || !purpose || !address || !city || !state) {
      return res.status(400).json({ error: "Campos obrigatorios nao informados." });
    }

    const normalizedPurpose = normalizePurpose(purpose);
    if (!normalizedPurpose) {
      return res.status(400).json({ error: "Finalidade do imovel invalida." });
    }

    let numericPrice: number;
    let numericPriceSale: number | null = null;
    let numericPriceRent: number | null = null;
    try {
      if (normalizedPurpose === "Venda") {
        numericPriceSale = parseOptionalPrice(price_sale) ?? parsePrice(price);
        numericPrice = numericPriceSale;
      } else if (normalizedPurpose === "Aluguel") {
        numericPriceRent = parseOptionalPrice(price_rent) ?? parsePrice(price);
        numericPrice = numericPriceRent;
      } else {
        numericPriceSale = parseOptionalPrice(price_sale);
        numericPriceRent = parseOptionalPrice(price_rent);
        if (numericPriceSale == null || numericPriceRent == null) {
          return res.status(400).json({
            error: "Informe os precos de venda e aluguel para esta finalidade.",
          });
        }
        numericPrice = numericPriceSale;
      }
    } catch (parseError) {
      return res.status(400).json({ error: (parseError as Error).message });
    }

    try {
      const [brokerRows] = await connection.query<RowDataPacket[]>(
        'SELECT status FROM brokers WHERE id = ?',
        [brokerId]
      );

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

      const [duplicateRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT id FROM properties
          WHERE address = ?
            AND COALESCE(quadra, '') = COALESCE(?, '')
            AND COALESCE(lote, '') = COALESCE(?, '')
            AND COALESCE(numero, '') = COALESCE(?, '')
            AND COALESCE(bairro, '') = COALESCE(?, '')
          LIMIT 1
        `,
        [address, quadra ?? null, lote ?? null, numero ?? null, bairro ?? null]
      );

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

      const imageUrls: string[] = [];
      const files = req.files ?? {};

      const imageFiles = files.images ?? [];
      if (imageFiles.length < 2) {
        return res.status(400).json({ error: 'Envie pelo menos 2 imagens do imovel.' });
      }
      for (const file of imageFiles) {
        const uploaded = await uploadToCloudinary(file, 'properties');
        imageUrls.push(uploaded.url);
      }

      let videoUrl: string | null = null;
      if (files.video && files.video[0]) {
        const uploadedVideo = await uploadToCloudinary(files.video[0], 'videos');
        videoUrl = uploadedVideo.url;
      }

      const [result] = await connection.query<ResultSetHeader>(
        `
          INSERT INTO properties (
            broker_id,
            title,
            description,
            type,
            purpose,
            status,
            price,
            price_sale,
            price_rent,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          brokerId,
          title,
          description,
          type,
          normalizedPurpose,
          'pending_approval',
          numericPrice,
          numericPriceSale,
          numericPriceRent,
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
        ]
      );

      const propertyId = result.insertId;

      if (imageUrls.length > 0) {
        const values = imageUrls.map((url) => [propertyId, url]);
        await connection.query(
          'INSERT INTO property_images (property_id, image_url) VALUES ?',
          [values]
        );
      }

      try {
        await notifyAdmins(
          `Um novo imóvel '${title}' foi adicionado e aguarda aprovação.`,
          'property',
          propertyId
        );
      } catch (notifyError) {
        console.error('Erro ao enviar notificação aos administradores:', notifyError);
      }

      return res.status(201).json({
        message: 'Imóvel criado com sucesso!',
        propertyId,
        status: 'pending_approval',
        images: imageUrls,
        video: videoUrl,
      });
    } catch (error) {
      console.error('Erro ao criar imóvel:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async update(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const brokerId = req.userId;

    if (!brokerId) {
      return res.status(401).json({ error: 'Corretor nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [propertyRows] = await connection.query<PropertyRow[]>(
        'SELECT * FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const property = propertyRows[0];

      if (property.broker_id !== brokerId) {
        return res.status(403).json({ error: 'Acesso nao autorizado a este imovel.' });
      }

      const previousSalePrice =
        property.price_sale != null ? Number(property.price_sale) : Number(property.price);
      const previousRentPrice =
        property.price_rent != null ? Number(property.price_rent) : Number(property.price);

      const body = req.body ?? {};
      const bodyKeys = Object.keys(body);

      const nextPurpose = normalizePurpose(body.purpose) ?? property.purpose;
      const purposeLower = String(nextPurpose ?? '').toLowerCase();
      const supportsSale = purposeLower.includes('vend');
      const supportsRent = purposeLower.includes('alug');
      let nextSalePrice = previousSalePrice;
      let nextRentPrice = previousRentPrice;
      let saleTouched = false;
      let rentTouched = false;

      if (property.status === 'approved') {
        const invalidKeys = bodyKeys.filter((key) => key !== 'status');
        if (invalidKeys.length > 0) {
          return res.status(403).json({
            error: 'Imoveis aprovados nao podem ter seus dados alterados, apenas o status.',
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
            'price_sale',
            'price_rent',
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

      const fields: string[] = [];
      const values: any[] = [];
      let nextStatus: Nullable<PropertyStatus> = null;

      for (const key of bodyKeys) {
        if (!updatableFields.has(key)) {
          continue;
        }

        switch (key) {
          case 'status': {
            const normalized = normalizeStatus(body.status);
            if (!normalized) {
              return res.status(400).json({ error: 'Status informado invalido.' });
            }
            nextStatus = normalized;
            fields.push('status = ?');
            values.push(normalized);
            break;
          }
          case 'purpose': {
            const normalized = normalizePurpose(body.purpose);
            if (!normalized) {
              return res.status(400).json({ error: 'Finalidade informada e invalida.' });
            }
            fields.push('purpose = ?');
            values.push(normalized);
            break;
          }
          case 'price': {
            try {
              const parsed = parsePrice(body.price);
              fields.push('price = ?');
              values.push(parsed);
              if (supportsSale && !supportsRent) {
                nextSalePrice = parsed;
                saleTouched = true;
              } else if (supportsRent && !supportsSale) {
                nextRentPrice = parsed;
                rentTouched = true;
              } else if (supportsSale && supportsRent) {
                nextSalePrice = parsed;
                saleTouched = true;
              }
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'price_sale':
          case 'price_rent': {
            try {
              const parsed = parsePrice(body[key]);
              fields.push(`\`${key}\` = ?`);
              values.push(parsed);
              if (key === 'price_sale') {
                nextSalePrice = parsed;
                saleTouched = true;
              } else {
                nextRentPrice = parsed;
                rentTouched = true;
              }
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'bedrooms':
          case 'bathrooms':
          case 'garage_spots': {
            try {
              fields.push(`\`${key}\` = ?`);
              values.push(parseInteger(body[key]));
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
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
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
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
        return res.status(400).json({ error: 'Nenhum dado fornecido para atualizacao.' });
      }

      values.push(propertyId);

      await connection.query(
        `UPDATE properties SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      if (Array.isArray(body.images) && property.status !== 'approved') {
        const images: string[] = body.images
          .filter((url: unknown) => typeof url === 'string' && url.trim().length > 0)
          .map((url: string) => url.trim());

        await connection.query('DELETE FROM property_images WHERE property_id = ?', [propertyId]);

        if (images.length > 0) {
          const imageValues = images.map((url) => [propertyId, url]);
          await connection.query(
            'INSERT INTO property_images (property_id, image_url) VALUES ?',
            [imageValues]
          );
        }
      }

      const effectiveStatus = nextStatus ?? property.status;
      if (effectiveStatus === 'approved' && (saleTouched || rentTouched)) {
        try {
          await notifyPriceDropIfNeeded({
            propertyId,
            propertyTitle: property.title,
            previousSalePrice,
            newSalePrice: saleTouched ? nextSalePrice : undefined,
            previousRentPrice,
            newRentPrice: rentTouched ? nextRentPrice : undefined,
          });
        } catch (notifyError) {
          console.error('Erro ao notificar queda de preco:', notifyError);
        }
      }

      if (nextStatus && NOTIFY_ON_STATUS.has(nextStatus)) {
        try {
          const action = nextStatus === 'sold' ? 'vendido' : 'alugado';
          await notifyAdmins(
            `O imovel '${property.title}' foi marcado como ${action}.`,
            'property',
            propertyId
          );
        } catch (notifyError) {
          console.error('Erro ao registrar notificacao:', notifyError);
        }

        const dealType = resolveDealTypeFromStatus(nextStatus);
        if (dealType) {
          let dealAmount: number;
          try {
            const fallbackPrice =
              dealType === 'sale'
                ? Number(property.price_sale ?? property.price)
                : Number(property.price_rent ?? property.price);
            dealAmount = resolveDealAmount(
              body.amount ?? body.sale_price ?? body.price,
              fallbackPrice
            );
          } catch (parseError) {
            return res.status(400).json({ error: (parseError as Error).message });
          }

          let commissionRate: number;
          try {
            commissionRate =
              parseDecimal(body.commission_rate) ??
              (property.commission_rate != null ? Number(property.commission_rate) : 5.0);
          } catch (parseError) {
            return res.status(400).json({ error: (parseError as Error).message });
          }

          let commissionCycles = 0;
          try {
            const parsedCycles = parseInteger(body.commission_cycles);
            if (parsedCycles != null) {
              if (parsedCycles < 0) {
                return res.status(400).json({ error: 'Comissoes ja realizadas invalidas.' });
              }
              commissionCycles = parsedCycles;
            }
          } catch (parseError) {
            return res.status(400).json({ error: (parseError as Error).message });
          }

          const normalizedInterval = normalizeRecurrenceInterval(body.recurrence_interval);
          if (
            body.recurrence_interval !== undefined &&
            body.recurrence_interval !== null &&
            normalizedInterval == null
          ) {
            return res.status(400).json({ error: 'Intervalo de recorrencia invalido.' });
          }
          const recurrenceInterval = normalizedInterval ?? 'none';

          const commissionAmount = calculateCommissionAmount(dealAmount, commissionRate);
          const iptuValue = property.valor_iptu != null ? Number(property.valor_iptu) : null;
          const condominioValue =
            property.valor_condominio != null ? Number(property.valor_condominio) : null;
          const isRecurring = recurrenceInterval !== 'none' ? 1 : 0;

          await upsertSaleRecord(connection, {
            propertyId,
            brokerId,
            dealType,
            salePrice: dealAmount,
            commissionRate,
            commissionAmount,
            iptuValue,
            condominioValue,
            isRecurring,
            commissionCycles,
            recurrenceInterval,
          });

          await connection.query(
            'UPDATE properties SET sale_value = ?, commission_rate = ?, commission_value = ? WHERE id = ?',
            [dealAmount, commissionRate, commissionAmount, propertyId]
          );
        }
      }

      return res.status(200).json({ message: 'Imovel atualizado com sucesso!' });
    } catch (error) {
      console.error('Erro ao atualizar imovel:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const { status } = req.body as { status?: string };
    const normalized = normalizeStatus(status);

    if (!normalized) {
      return res.status(400).json({ error: 'Status informado é inválido.' });
    }

    req.body = { status: normalized } as any;
    return this.update(req, res);
  }

  async closeDeal(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const brokerId = req.userId;

    if (!brokerId) {
      return res.status(401).json({ error: 'Corretor nÆo autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de im¢vel inv lido.' });
    }

    const { type, amount, commission_rate, commission_cycles, recurrence_interval } = req.body as {
      type?: string;
      amount?: number | string;
      commission_rate?: number | string;
      commission_cycles?: number | string;
      recurrence_interval?: string;
    };

    const dealType = normalizeDealType(type);
    if (!dealType) {
      return res.status(400).json({ error: 'Tipo de negocio invalido.' });
    }

    try {
      const [propertyRows] = await connection.query<PropertyRow[]>(
        'SELECT * FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Im¢vel nÆo encontrado.' });
      }

      const property = propertyRows[0];
      if (property.broker_id !== brokerId) {
        return res.status(403).json({ error: 'Acesso nÆo autorizado a este im¢vel.' });
      }

      if (property.status === 'pending_approval' || property.status === 'rejected') {
        return res.status(403).json({ error: 'Imovel ainda nao pode ser fechado.' });
      }

      

      if (!purposeAllowsDeal(property.purpose, dealType)) {
        return res.status(400).json({ error: 'Tipo de negocio nao permitido para esta finalidade.' });
      }

      const fallbackPrice =
        dealType === 'sale'
          ? Number(property.price_sale ?? property.price)
          : Number(property.price_rent ?? property.price);
      let dealAmount: number;
      try {
        dealAmount = resolveDealAmount(amount, fallbackPrice);
      } catch (parseError) {
        return res.status(400).json({ error: (parseError as Error).message });
      }

      let commissionRate: number;
      try {
        commissionRate =
          parseDecimal(commission_rate) ??
          (property.commission_rate != null ? Number(property.commission_rate) : 5.0);
      } catch (parseError) {
        return res.status(400).json({ error: (parseError as Error).message });
      }

      let commissionCycles = 0;
      try {
        const parsedCycles = parseInteger(commission_cycles);
        if (parsedCycles != null) {
          if (parsedCycles < 0) {
            return res.status(400).json({ error: "Comissoes ja realizadas invalidas." });
          }
          commissionCycles = parsedCycles;
        }
      } catch (parseError) {
        return res.status(400).json({ error: (parseError as Error).message });
      }

      const normalizedInterval = normalizeRecurrenceInterval(recurrence_interval);
      if (
        recurrence_interval !== undefined &&
        recurrence_interval !== null &&
        normalizedInterval == null
      ) {
        return res.status(400).json({ error: "Intervalo de recorrencia invalido." });
      }
      const recurrenceInterval = normalizedInterval ?? "none";

      const commissionAmount = calculateCommissionAmount(dealAmount, commissionRate);
      const iptuValue = property.valor_iptu != null ? Number(property.valor_iptu) : null;
      const condominioValue =
        property.valor_condominio != null ? Number(property.valor_condominio) : null;
      const newStatus: PropertyStatus = dealType === 'sale' ? 'sold' : 'rented';
      const isRecurring = recurrenceInterval !== "none" ? 1 : 0;

      const db = await connection.getConnection();
      try {
        await db.beginTransaction();
        await db.query(
          'UPDATE properties SET status = ?, sale_value = ?, commission_rate = ?, commission_value = ? WHERE id = ?',
          [newStatus, dealAmount, commissionRate, commissionAmount, propertyId]
        );

        await upsertSaleRecord(db, {
          propertyId,
          brokerId,
          dealType,
          salePrice: dealAmount,
          commissionRate,
          commissionAmount,
          iptuValue,
          condominioValue,
          isRecurring,
          commissionCycles,
          recurrenceInterval,
        });

        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }

      return res.status(200).json({
        message: 'Negocio fechado com sucesso.',
        status: newStatus,
        sale: {
          property_id: propertyId,
          deal_type: dealType,
          sale_price: dealAmount,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
          iptu_value: iptuValue,
          condominio_value: condominioValue,
          is_recurring: isRecurring,
          commission_cycles: commissionCycles,
          recurrence_interval: recurrenceInterval,
        },
      });
    } catch (error) {
      console.error('Erro ao fechar negocio:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async cancelDeal(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const brokerId = req.userId;

    if (!brokerId) {
      return res.status(401).json({ error: 'Corretor nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [propertyRows] = await connection.query<PropertyRow[]>(
        'SELECT id, broker_id, status FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const property = propertyRows[0];
      if (property.broker_id !== brokerId) {
        return res.status(403).json({ error: 'Acesso nao autorizado a este imovel.' });
      }

      if (property.status !== 'sold' && property.status !== 'rented') {
        return res.status(400).json({ error: 'Este imovel nao possui negocio fechado.' });
      }

      const db = await connection.getConnection();
      try {
        await db.beginTransaction();
        await db.query(
          'UPDATE properties SET status = ?, sale_value = NULL, commission_rate = NULL, commission_value = NULL WHERE id = ?',
          ['approved', propertyId]
        );
        await db.query('DELETE FROM sales WHERE property_id = ?', [propertyId]);
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }

      return res.status(200).json({
        message: 'Negocio cancelado com sucesso.',
        status: 'approved',
      });
    } catch (error) {
      console.error('Erro ao cancelar negocio:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async delete(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const brokerId = req.userId;

    if (!brokerId) {
      return res.status(401).json({ error: 'Corretor não autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
    }

    try {
      const [propertyRows] = await connection.query<RowDataPacket[]>(
        'SELECT broker_id FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      if (propertyRows[0].broker_id !== brokerId) {
        return res.status(403).json({ error: 'Você não tem permissão para deletar este imóvel.' });
      }

      await connection.query('DELETE FROM properties WHERE id = ?', [propertyId]);

      return res.status(200).json({ message: 'Imóvel deletado com sucesso!' });
    } catch (error) {
      console.error('Erro ao deletar imóvel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getAvailableCities(req: Request, res: Response) {
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT DISTINCT city
          FROM properties
          WHERE city IS NOT NULL AND city <> ''
          ORDER BY city ASC
        `
      );
      return res.status(200).json(rows.map((row) => row.city));
    } catch (error) {
      console.error('Erro ao buscar cidades disponíveis:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listPublicProperties(req: Request, res: Response) {
    const {
      page = '1',
      limit = '20',
      type,
      purpose,
      city,
      bairro,
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
    const params: any[] = [];

    const statusFilter = normalizeStatus(status);
    const effectiveStatus = statusFilter ?? 'approved';
    whereClauses.push('p.status = ?');
    params.push(effectiveStatus);

    if (type) {
      whereClauses.push('p.type = ?');
      params.push(type);
    }

    const normalizedPurpose = normalizePurpose(purpose);
    let priceColumn = 'p.price';
    if (normalizedPurpose) {
      if (normalizedPurpose === 'Venda') {
        whereClauses.push('(p.purpose = ? OR p.purpose = ?)');
        params.push('Venda', 'Venda e Aluguel');
        priceColumn = 'COALESCE(p.price_sale, p.price)';
      } else if (normalizedPurpose === 'Aluguel') {
        whereClauses.push('(p.purpose = ? OR p.purpose = ?)');
        params.push('Aluguel', 'Venda e Aluguel');
        priceColumn = 'COALESCE(p.price_rent, p.price)';
      } else {
        whereClauses.push('p.purpose = ?');
        params.push('Venda e Aluguel');
        priceColumn = 'COALESCE(p.price_sale, p.price)';
      }
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
        whereClauses.push(`${priceColumn} >= ?`);
        params.push(value);
      }
    }

    if (maxPrice) {
      const value = Number(maxPrice);
      if (!Number.isNaN(value)) {
        whereClauses.push(`${priceColumn} <= ?`);
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

    const allowedSortColumns: Record<string, string> = {
      price: priceColumn,
      created_at: 'p.created_at',
      area_construida: 'p.area_construida',
    };

    const sortColumn = allowedSortColumns[String(sortBy ?? '').toLowerCase()] ?? 'p.created_at';
    const sortDirection = String(order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
      const [rows] = await connection.query<PropertyAggregateRow[]>(
        `
          SELECT
            p.*,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            ANY_VALUE(u.name) AS broker_name,
            ANY_VALUE(u.phone) AS broker_phone,
            ANY_VALUE(u.email) AS broker_email,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          ${where}
          GROUP BY p.id
          ORDER BY ${sortColumn} ${sortDirection}
          LIMIT ? OFFSET ?
        `,
        [...params, numericLimit, offset]
      );

      const [totalRows] = await connection.query<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT p.id) AS total FROM properties p ${where}`,
        params
      );

      const total = totalRows[0]?.total ?? 0;

      return res.json({
        properties: rows.map(mapProperty),
        total,
        page: numericPage,
        totalPages: Math.ceil(total / numericLimit),
      });
    } catch (error: any) {
      console.error('Erro ao listar imóveis:', error);
      const code = error?.code as string | undefined;
      if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'PROTOCOL_CONNECTION_LOST') {
        return res
          .status(503)
          .json({ error: 'Banco de dados indisponível. Tente novamente em instantes.' });
      }
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }
}

export const propertyController = new PropertyController();

