import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import AuthRequest from "../middlewares/auth";
import { submitPropertyEditRequest } from "../services/propertyEditSubmissionService";
import { updateProperty } from "../services/propertyUpdateService";
import {
  cancelPropertyDeal,
  closePropertyDeal,
  deleteProperty,
  resubmitRejectedProperty,
} from "../services/propertyLifecycleService";
import {
  normalizeAreaUnidade,
  type AreaConstruidaUnidade,
} from "../utils/propertyAreaUnits";
import {
  toCanonicalAmenity,
} from "../utils/propertyAmenities";
import { stripExpiredPromotionFromPublicPayload } from "../utils/promotionPublicWindow";
import {
  getPropertyById as getPropertyByIdService,
  getAvailableBairrosWithCount as getAvailableBairrosWithCountService,
  getAvailableCities as getAvailableCitiesService,
  getAvailableCitiesWithCount as getAvailableCitiesWithCountService,
  getPropertyByPublicLookup as getPropertyByPublicLookupService,
  listFeaturedProperties as listFeaturedPropertiesService,
  resolvePublicPropertyLookupValue,
} from '../services/propertyDiscoveryService';
import {
  isPropertyListingError,
  listPublicProperties as listPublicPropertiesService,
  listUserProperties as listUserPropertiesService,
} from '../services/propertyListingService';
import {
  createBrokerProperty as createBrokerPropertyService,
  createClientProperty as createClientPropertyService,
} from '../services/propertyCreationService';

interface MulterFiles {
  [fieldname: string]: Express.Multer.File[];
}

export interface AuthRequestWithFiles extends AuthRequest {
  files?: MulterFiles;
}
type PropertyStatus = "pending_approval" | "approved" | "rejected" | "rented" | "sold";

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

interface PropertyRow extends RowDataPacket {
  id: number;
  broker_id: number | null;
  owner_id?: number | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_email?: string | null;
  title: string;
  description: string;
  type: string;
  purpose: string;
  status: string;
  rejection_reason?: string | null;
  visibility?: string | null;
  lifecycle_status?: string | null;
  is_promoted?: number | boolean | null;
  promotion_percentage?: number | string | null;
  promotion_start?: Date | string | null;
  promotion_end?: Date | string | null;
  promo_percentage?: number | string | null;
  promo_start_date?: Date | string | null;
  promo_end_date?: Date | string | null;
  promotional_rent_percentage?: number | string | null;
  promo_percentage_resolved?: number | string | null;
  promo_start_date_resolved?: Date | string | null;
  promo_end_date_resolved?: Date | string | null;
  price: number | string;
  price_sale?: number | string | null;
  price_rent?: number | string | null;
  promotion_price?: number | string | null;
  promotional_rent_price?: number | string | null;
  code?: string | null;
  public_id?: string | null;
  public_code?: string | null;
  address: string;
  quadra?: string | null;
  lote?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  city: string;
  state: string;
  cep?: string | null;
  sem_cep?: number | boolean | string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_construida?: number | string | null;
  area_construida_unidade?: string | null;
  area_terreno?: number | string | null;
  area_construida_valor?: number | string | null;
  area_construida_m2?: number | string | null;
  area_terreno_valor?: number | string | null;
  area_terreno_unidade?: string | null;
  area_terreno_m2?: number | string | null;
  sem_quadra?: number | boolean | string | null;
  sem_lote?: number | boolean | string | null;
  garage_spots?: number | null;
  amenities?: unknown;
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
  pending_edit_request_id?: number | null;
  images?: string | null;
  agency_id?: number | null;
  agency_name?: string | null;
  agency_logo_url?: string | null;
  agency_address?: string | null;
  agency_city?: string | null;
  agency_state?: string | null;
  agency_phone?: string | null;
  active_negotiation_id?: string | null;
  active_negotiation_status?: string | null;
  active_negotiation_value?: number | string | null;
  active_negotiation_client_name?: string | null;
}

interface PropertyAggregateRow extends PropertyRow {
  images?: string | null;
}

function parsePropertyAmenitiesFromRow(value: unknown): string[] | null {
  if (value == null) {
    return null;
  }
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => {
        const entry = String(item).trim();
        return toCanonicalAmenity(entry) ?? entry;
      })
      .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed)) {
        const parsedList = parsed
          .map((item) => {
            const entry = String(item).trim();
            return toCanonicalAmenity(entry) ?? entry;
          })
          .filter((entry) => entry.length > 0);
        return parsedList.length > 0 ? parsedList : null;
      }
    } catch {
      const normalizedEntry = toCanonicalAmenity(normalized) ?? normalized;
      return normalizedEntry.length > 0 ? [normalizedEntry] : null;
    }
  }
  return null;
}

const LEGACY_AMENITY_BOOLEAN_FIELDS: Array<{ field: keyof PropertyRow; canonical: string }> = [
  { field: "has_wifi", canonical: "Wi-Fi" },
  { field: "tem_piscina", canonical: "Piscina" },
  { field: "tem_energia_solar", canonical: "Energia solar" },
  { field: "tem_automacao", canonical: "Automação" },
  { field: "tem_ar_condicionado", canonical: "Ar condicionado" },
  { field: "eh_mobiliada", canonical: "Mobiliada" },
];

function mergePropertyAmenities(row: PropertyAggregateRow): string[] {
  const jsonAmenities = parsePropertyAmenitiesFromRow(row.amenities) ?? [];
  const legacyAmenities = LEGACY_AMENITY_BOOLEAN_FIELDS.flatMap(({ field, canonical }) =>
    toBoolean(row[field]) ? [canonical] : [],
  );

  const merged = new Set<string>();
  for (const entry of [...jsonAmenities, ...legacyAmenities]) {
    const canonical = toCanonicalAmenity(entry);
    if (canonical !== null) {
      merged.add(canonical);
    }
  }

  return Array.from(merged);
}

function toPublicAmenityLabel(label: string): string {
  const normalized = String(label ?? "").trim();
  if (!normalized) {
    return normalized;
  }
  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\/[a-z]/g, (match) => `/${match[1].toUpperCase()}`);
}

function normalizePublicAmenities(
  value: string[] | null,
): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const normalized = value
    .map((entry) => {
      const normalizedEntry =
        toCanonicalAmenity(String(entry ?? "")) ?? String(entry ?? "").trim();
      return toPublicAmenityLabel(normalizedEntry);
    })
    .filter((entry) => entry.length > 0)
    .filter((entry) => entry.toUpperCase() !== 'PLANEJADOS')
    ;

  for (const entry of normalized) {
    seen.add(entry);
  }
  return Array.from(seen);
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

function mapProperty(row: PropertyAggregateRow, includeOwnerInfo = false) {
  const images = row.images ? row.images.split(",").filter(Boolean) : [];
  const mergedAmenities = mergePropertyAmenities(row);
  const activeNegotiationId = stringOrNull(row.active_negotiation_id);
  const activeNegotiationStatus = stringOrNull(row.active_negotiation_status);
  const activeNegotiationClientName = stringOrNull(
    row.active_negotiation_client_name
  );
  const activeNegotiationValue =
    row.active_negotiation_value != null
      ? Number(row.active_negotiation_value)
      : null;
  const negotiation = activeNegotiationId
    ? {
      id: activeNegotiationId,
      status: activeNegotiationStatus,
      client_name: activeNegotiationClientName,
      clientName: activeNegotiationClientName,
      value: activeNegotiationValue,
    }
    : null;

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

  const mapped = {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    purpose: row.purpose,
    status: row.status,
    visibility: row.visibility ?? 'PUBLIC',
    lifecycle_status: row.lifecycle_status ?? 'AVAILABLE',
    is_promoted: toBoolean(row.is_promoted),
    promotion_percentage:
      row.promo_percentage_resolved != null
        ? Number(row.promo_percentage_resolved)
        : row.promo_percentage != null
          ? Number(row.promo_percentage)
          : row.promotion_percentage != null
            ? Number(row.promotion_percentage)
            : null,
    promotion_start:
      row.promo_start_date_resolved ?? row.promo_start_date ?? row.promotion_start ?? null,
    promotion_end:
      row.promo_end_date_resolved ?? row.promo_end_date ?? row.promotion_end ?? null,
    promo_percentage:
      row.promo_percentage_resolved != null
        ? Number(row.promo_percentage_resolved)
        : row.promotion_percentage != null
          ? Number(row.promotion_percentage)
          : null,
    promo_start_date:
      row.promo_start_date_resolved ?? row.promo_start_date ?? row.promotion_start ?? null,
    promo_end_date:
      row.promo_end_date_resolved ?? row.promo_end_date ?? row.promotion_end ?? null,
    promoPercentage:
      row.promo_percentage_resolved != null
        ? Number(row.promo_percentage_resolved)
        : row.promotion_percentage != null
          ? Number(row.promotion_percentage)
          : null,
    promoStartDate:
      row.promo_start_date_resolved ?? row.promo_start_date ?? row.promotion_start ?? null,
    promoEndDate:
      row.promo_end_date_resolved ?? row.promo_end_date ?? row.promotion_end ?? null,
    price: Number(row.price),
    price_sale: row.price_sale != null ? Number(row.price_sale) : null,
    price_rent: row.price_rent != null ? Number(row.price_rent) : null,
    promotion_price:
      row.promotion_price != null ? Number(row.promotion_price) : null,
    promotional_rent_price:
      row.promotional_rent_price != null ? Number(row.promotional_rent_price) : null,
    promotional_rent_percentage:
      row.promotional_rent_percentage != null
        ? Number(row.promotional_rent_percentage)
        : null,
    promotionalPrice:
      row.promotion_price != null ? Number(row.promotion_price) : null,
    promotionPrice:
      row.promotion_price != null ? Number(row.promotion_price) : null,
    promotionalRentPrice:
      row.promotional_rent_price != null
        ? Number(row.promotional_rent_price)
        : null,
    promotionalRentPercentage:
      row.promotional_rent_percentage != null
        ? Number(row.promotional_rent_percentage)
        : null,
    broker_id: row.broker_id != null ? Number(row.broker_id) : null,
    owner_id: row.owner_id != null ? Number(row.owner_id) : null,
    code: row.code ?? null,
    public_id: row.public_id ?? null,
    public_code: row.public_code ?? null,
    owner_name: includeOwnerInfo ? (row.owner_name ?? null) : null,
    owner_phone: includeOwnerInfo ? (row.owner_phone ?? null) : null,
    address: row.address,
    cep: row.cep ?? null,
    quadra: row.quadra ?? null,
    lote: row.lote ?? null,
    numero: row.numero ?? null,
    bairro: row.bairro ?? null,
    complemento: row.complemento ?? null,
    city: row.city,
    state: row.state,
    sem_cep: toBoolean((row as PropertyRow & { sem_cep?: unknown }).sem_cep),
    bedrooms: row.bedrooms != null ? Number(row.bedrooms) : null,
    bathrooms: row.bathrooms != null ? Number(row.bathrooms) : null,
    area_construida:
      row.area_construida_valor != null
        ? Number(row.area_construida_valor)
        : row.area_construida_m2 != null
          ? Number(row.area_construida_m2)
          : row.area_construida != null
            ? Number(row.area_construida)
            : null,
    area_construida_unidade: normalizeAreaUnidade(
      (row as PropertyRow & { area_construida_unidade?: string | null })
        .area_construida_unidade,
    ) as AreaConstruidaUnidade,
    area_construida_valor:
      row.area_construida_valor != null ? Number(row.area_construida_valor) : null,
    area_construida_m2:
      row.area_construida_m2 != null ? Number(row.area_construida_m2) : null,
    sem_quadra: toBoolean((row as PropertyRow & { sem_quadra?: unknown }).sem_quadra),
    sem_lote: toBoolean((row as PropertyRow & { sem_lote?: unknown }).sem_lote),
    area_terreno:
      row.area_terreno_valor != null
        ? Number(row.area_terreno_valor)
        : row.area_terreno_m2 != null
          ? Number(row.area_terreno_m2)
          : row.area_terreno != null
            ? Number(row.area_terreno)
            : null,
    area_terreno_valor:
      row.area_terreno_valor != null ? Number(row.area_terreno_valor) : null,
    area_terreno_m2:
      row.area_terreno_m2 != null ? Number(row.area_terreno_m2) : null,
    area_terreno_unidade: normalizeAreaUnidade(
      (row as PropertyRow & { area_terreno_unidade?: string | null })
        .area_terreno_unidade,
    ) as AreaConstruidaUnidade,
    garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
    amenities: includeOwnerInfo ? mergedAmenities : normalizePublicAmenities(mergedAmenities),
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
    negotiation_id: activeNegotiationId,
    active_negotiation_id: activeNegotiationId,
    activeNegotiationId: activeNegotiationId,
    negotiation,
    activeNegotiation: negotiation,
    hasPendingEditRequest:
      row.pending_edit_request_id != null &&
      Number(row.pending_edit_request_id) > 0,
    pendingEditRequestId:
      row.pending_edit_request_id != null
        ? Number(row.pending_edit_request_id)
        : null,
    rejection_reason: row.rejection_reason != null ? String(row.rejection_reason) : null,
    rejectionReason: row.rejection_reason != null ? String(row.rejection_reason) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return stripExpiredPromotionFromPublicPayload(mapped, includeOwnerInfo);
}


class PropertyController {
  async show(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const property = await getPropertyByIdService(propertyId);

      if (!property) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }
      const isOwner =
        (property.broker_id != null && property.broker_id === (req as AuthRequest).userId) ||
        (property.owner_id != null && property.owner_id === (req as AuthRequest).userId);
      const isAdmin = (req as AuthRequest).userRole === 'admin';
      const isPubliclyVisible =
        property.status === 'approved' &&
        String(property.visibility ?? 'PUBLIC').toUpperCase() === 'PUBLIC';
      if (property.status === 'pending_approval' && !isAdmin && !isOwner) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }
      if (!isOwner && !isAdmin && !isPubliclyVisible) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }
      const showOwnerInfo = isOwner || isAdmin;

      return res.status(200).json(mapProperty(property, showOwnerInfo));
    } catch (error) {
      console.error("Erro ao buscar imóvel:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async showPublic(req: Request, res: Response) {
    const lookup = resolvePublicPropertyLookupValue(req.params.id);
    if (!lookup) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const property = await getPropertyByPublicLookupService(req.params.id, {
        publicOnly: true,
      });

      if (!property) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }

      return res.status(200).json(mapProperty(property, false));
    } catch (error) {
      console.error("Erro ao buscar imóvel público:", error);
      return res.status(500).json({ error: "Ocorreu um erro inesperado no servidor." });
    }
  }

  async create(req: AuthRequestWithFiles, res: Response) {
    return createBrokerPropertyService(req, res);
  }

  async createForClient(req: AuthRequestWithFiles, res: Response) {
    return createClientPropertyService(req, res);
  }

  async createEditRequest(req: AuthRequest, res: Response) {
    return submitPropertyEditRequest(req, res);
  }

  async update(req: AuthRequest, res: Response) {
    return updateProperty(req, res);
  }

  /**
   * Reenvia imóvel rejeitado para fila de análise sem outras alterações de payload.
   * Mesmo efeito de status / rejection_reason / visibility que o PATCH com dados ou imagens.
   */
  async resubmitApproval(req: AuthRequest, res: Response) {
    return resubmitRejectedProperty(req, res);
  }

  async updateStatus(req: AuthRequest, res: Response) {
    const { status } = req.body as { status?: string };
    const normalized = normalizeStatus(status);

    if (!normalized) {
      return res.status(400).json({ error: 'Status informado é inválido.' });
    }

    req.body = { status: normalized } as any;
    return updateProperty(req, res);
  }

  async closeDeal(req: AuthRequest, res: Response) {
    return closePropertyDeal(req, res);
  }

  async cancelDeal(req: AuthRequest, res: Response) {
    return cancelPropertyDeal(req, res);
  }

  async delete(req: AuthRequest, res: Response) {
    return deleteProperty(req, res);
  }

  async getAvailableCities(_req: Request, res: Response) {
    try {
      const rows = await getAvailableCitiesService();
      return res.status(200).json(rows);
    } catch (error) {
      console.error('Erro ao buscar cidades disponíveis:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getAvailableCitiesWithCount(_req: Request, res: Response) {
    try {
      const rows = await getAvailableCitiesWithCountService();
      return res.status(200).json(rows);
    } catch (error) {
      console.error('Erro ao buscar cidades disponíveis com contagem:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getAvailableBairrosWithCount(req: Request, res: Response) {
    const city = String(req.query.city ?? '').trim();
    try {
      const rows = await getAvailableBairrosWithCountService(city);
      return res.status(200).json(rows);
    } catch (error) {
      console.error('Erro ao buscar bairros disponíveis com contagem:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listUserProperties(req: AuthRequest, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    try {
      const rows = await listUserPropertiesService(userId);
      return res.json(rows);
    } catch (error) {
      console.error('Erro ao listar imóveis do usuário:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async listPublicProperties(req: Request, res: Response) {
    try {
      const result = await listPublicPropertiesService(req.query as Record<string, unknown>);
      return res.json(result);
    } catch (error: any) {
      if (isPropertyListingError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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
  async listFeaturedProperties(req: Request, res: Response) {
    try {
      const result = await listFeaturedPropertiesService({
        scope: typeof req.query.scope === 'string' ? req.query.scope : undefined,
        page: typeof req.query.page === 'string' ? req.query.page : undefined,
        limit: typeof req.query.limit === 'string' ? req.query.limit : undefined,
      });
      return res.json(result);
    } catch (error) {
      console.error('Erro ao listar destaques:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

}

export const propertyController = new PropertyController();


