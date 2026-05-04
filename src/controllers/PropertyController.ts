import { Request, Response } from "express";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { deleteCloudinaryAsset, uploadToCloudinary } from "../config/cloudinary";
import AuthRequest from "../middlewares/auth";
import { createAdminNotification, notifyAdmins } from "../services/notificationService";
import {
  getPropertyDbConnection,
  propertyQueryExecutor,
  runPropertyQuery,
  type PropertyQueryExecutor,
} from "../services/propertyPersistenceService";
import { getRequestId } from "../middlewares/requestContext";
import {
  notifyPriceDropIfNeeded,
  notifyPromotionStarted,
} from "../services/priceDropNotificationService";
import {
  buildEditablePropertyState,
  buildPropertyEditDbPatch,
  preparePropertyEditPatch,
  type EditablePropertyPatch,
} from "../services/propertyEditRequestService";
import {
  isOptionalBairroPropertyType,
  normalizePropertyType,
} from "../utils/propertyTypes";
import { allocateNextPropertyCode } from "../utils/propertyCode";
import {
  areaInputToSquareMeters,
  normalizeAreaUnidade,
  type AreaConstruidaUnidade,
} from "../utils/propertyAreaUnits";
import { normalizePropertyAmenities } from "../utils/propertyAmenities";
import { stripExpiredPromotionFromPublicPayload } from "../utils/promotionPublicWindow";

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

const MAX_IMAGES_PER_PROPERTY = 20;
const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_GENERIC_PROPERTY_TEXT_LENGTH = 120;
const MAX_PROPERTY_COUNT = 99;
const MAX_PROPERTY_AREA = 9999999.99;
const MAX_PROPERTY_PRICE = 9999999999.99;
const MAX_PROPERTY_FEE = 99999999.99;
const ALLOWED_PROPERTY_TEXT_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'address',
  'city',
  'state',
  'bairro',
  'code',
  'quadra',
  'lote',
  'complemento',
  'owner_name',
  'cep',
  'visibility',
  'lifecycle_status',
  'video_url',
]);

const NOTIFY_ON_STATUS: Set<PropertyStatus> = new Set(["sold", "rented"]);
const NEGOTIATION_TERMINAL_STATUSES = ['CANCELLED', 'REJECTED', 'EXPIRED', 'SOLD', 'RENTED'];
// Regras de vitrine: o imóvel só deve sair da listagem pública após envio da proposta assinada.
const NEGOTIATION_PUBLIC_BLOCKING_STATUSES = [
  'IN_NEGOTIATION',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
];

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

function logPropertyCreateValidationFailure(
  req: Request,
  flow: "broker" | "client",
  reason: string,
  details?: Record<string, unknown>
): void {
  console.warn("Property create validation failed:", {
    requestId: getRequestId(req),
    flow,
    reason,
    details,
  });
}

async function cleanupPropertyMediaAssets(
  urls: Array<string | null | undefined>,
  context: string,
): Promise<void> {
  for (const rawUrl of urls) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) {
      continue;
    }

    try {
      await deleteCloudinaryAsset({ url, invalidate: true });
    } catch (error) {
      console.error(`Erro ao excluir asset do Cloudinary (${context}):`, {
        url,
        error,
      });
    }
  }
}

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
  status: PropertyStatus;
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
    return value.length > 0 ? value.map((item) => String(item)) : null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    try {
      const parsed = JSON.parse(normalized);
      if (Array.isArray(parsed)) {
        return parsed.length > 0 ? parsed.map((item) => String(item)) : null;
      }
    } catch {
      return normalized.length > 0 ? [normalized] : null;
    }
  }
  return null;
}

interface PropertyEditRequestRow extends RowDataPacket {
  id: number;
  property_id: number;
  requester_user_id: number;
  requester_role: string;
  status: string;
  before_json: unknown;
  after_json: unknown;
  diff_json: unknown;
  review_reason: string | null;
  reviewed_by: number | null;
  reviewed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
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

function parseInteger(
  value: unknown,
  options?: { label?: string },
): Nullable<number> {
  const label = options?.label ?? "Valor inteiro";
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${label} inválido.`);
  }
  return parsed;
}

function normalizeNumericCountField(
  value: unknown,
  options: { label: string; required?: boolean; hasField: boolean },
): Nullable<number> {
  const { label, required = false, hasField } = options;
  if (value === undefined || value === null) {
    if (!hasField) {
      return null;
    }
    return required ? 0 : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      if (!hasField) {
        return null;
      }
      return required ? 0 : 0;
    }

    const normalized = trimmed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
    const hasDigits = /\d/.test(normalized);
    const isSemValue =
      normalized === "s/n" ||
      normalized === "sn" ||
      normalized === "sem" ||
      (/\bsem\b/.test(normalized) && !hasDigits);
    if (isSemValue) {
      return 0;
    }
  }

  const parsed = parseInteger(value, { label });
  if (parsed == null) {
    return null;
  }
  if (parsed < 0) {
    throw new Error(`${label} deve ser no mínimo 0.`);
  }
  return parsed;
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

function parsePromotionPercentage(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("Percentual de promocao invalido. Use valor entre 0 e 100.");
  }
  return Number(parsed.toFixed(2));
}

function parsePromotionDateTime(value: unknown): Nullable<string> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data de promocao invalida.");
  }
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function parsePromotionDate(value: unknown): Nullable<string> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Data de promocao invalida.");
  }
  return parsed.toISOString().slice(0, 10);
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

function normalizeCepForPersistence(value: unknown, semCepFlag: 0 | 1): string | null {
  if (semCepFlag === 1) {
    return null;
  }

  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function normalizeAddressNumberForPersistence(
  rawNumber: unknown,
  semNumeroFlag: 0 | 1
): string | null {
  if (semNumeroFlag === 1) {
    return null;
  }

  const normalizedRaw = String(rawNumber ?? '').trim();
  if (!normalizedRaw) {
    return null;
  }

  const normalizedNoSpace = normalizedRaw.replace(/\s+/g, '').toUpperCase();
  if (normalizedNoSpace === 'S/N' || normalizedNoSpace === 'SN') {
    return null;
  }

  const sanitized = normalizedRaw
    .normalize('NFD')
    .replace(/[^\w/-]/g, '')
    .trim();
  return sanitized.length > 0 ? sanitized.toUpperCase() : null;
}

function validateRequiredBairro(
  bairro: unknown,
  propertyType: unknown
): string | null {
  if (isOptionalBairroPropertyType(propertyType)) {
    return null;
  }

  return stringOrNull(bairro) ? null : 'Bairro é obrigatório.';
}

function mapProperty(row: PropertyAggregateRow, includeOwnerInfo = false) {
  const images = row.images ? row.images.split(",").filter(Boolean) : [];
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
      row.area_construida != null ? Number(row.area_construida) : null,
    area_construida_unidade: normalizeAreaUnidade(
      (row as PropertyRow & { area_construida_unidade?: string | null })
        .area_construida_unidade,
    ) as AreaConstruidaUnidade,
    sem_quadra: toBoolean((row as PropertyRow & { sem_quadra?: unknown }).sem_quadra),
    sem_lote: toBoolean((row as PropertyRow & { sem_lote?: unknown }).sem_lote),
    area_terreno: row.area_terreno != null ? Number(row.area_terreno) : null,
    garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
    amenities: parsePropertyAmenitiesFromRow(row.amenities),
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

function hasValidPropertyDescription(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = normalizePropertyDescription(value);
  return normalized.length > 0 && normalized.length <= MAX_PROPERTY_DESCRIPTION_LENGTH;
}

function normalizePropertyDescription(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function buildUpdateStatementFromPatch(
  dbPatch: Record<string, unknown>
): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(dbPatch)) {
    assignments.push(`\`${key}\` = ?`);
    values.push(value);
  }

  return { assignments, values };
}

function resolveEditRequesterRole(req: AuthRequest): 'broker' | 'client' {
  return String(req.userRole ?? '').toLowerCase() === 'broker' ? 'broker' : 'client';
}

function validateMaxTextLength(
  value: unknown,
  label: string,
  maxLength: number = MAX_GENERIC_PROPERTY_TEXT_LENGTH,
): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    return `${label} deve ter no máximo ${maxLength} caracteres.`;
  }
  return null;
}

function validatePropertyNumericRange(
  value: number | null,
  label: string,
  options: { max: number; allowNull?: boolean },
): string | null {
  if (value == null) {
    return options.allowNull ? null : `${label} inválido.`;
  }
  if (value < 0) {
    return `${label} deve ser no mínimo 0.`;
  }
  if (value > options.max) {
    return `${label} deve ser no máximo ${options.max}.`;
  }
  return null;
}

async function upsertSaleRecord(
  db: PropertyQueryExecutor,
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

async function fetchPropertyAggregateById(
  propertyId: number,
  options?: { publicOnly?: boolean }
): Promise<PropertyAggregateRow | null> {
  const publicOnly = options?.publicOnly === true;
  const rows = await runPropertyQuery<PropertyAggregateRow[]>(
    `
      SELECT
        p.*,
        COALESCE(p.promo_percentage, p.promotion_percentage) AS promo_percentage_resolved,
        COALESCE(p.promo_start_date, DATE(p.promotion_start)) AS promo_start_date_resolved,
        COALESCE(p.promo_end_date, DATE(p.promotion_end)) AS promo_end_date_resolved,
        ANY_VALUE(a.id) AS agency_id,
        ANY_VALUE(a.name) AS agency_name,
        ANY_VALUE(a.logo_url) AS agency_logo_url,
        ANY_VALUE(a.address) AS agency_address,
        ANY_VALUE(a.city) AS agency_city,
        ANY_VALUE(a.state) AS agency_state,
        ANY_VALUE(a.phone) AS agency_phone,
        ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
        ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
        ANY_VALUE(COALESCE(u.email, u_owner.email)) AS broker_email,
        ANY_VALUE(an.id) AS active_negotiation_id,
        ANY_VALUE(an.status) AS active_negotiation_status,
        ANY_VALUE(an.final_value) AS active_negotiation_value,
        ANY_VALUE(nbu.name) AS active_negotiation_client_name,
        ANY_VALUE(per.id) AS pending_edit_request_id,
        GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
      FROM properties p
      LEFT JOIN brokers b ON p.broker_id = b.id
      LEFT JOIN users u ON u.id = b.id
      LEFT JOIN users u_owner ON u_owner.id = p.owner_id
      LEFT JOIN agencies a ON b.agency_id = a.id
      LEFT JOIN (
        SELECT
          ranked.property_id,
          ranked.id,
          ranked.status,
          ranked.final_value,
          ranked.buyer_client_id
        FROM (
          SELECT
            n.property_id,
            n.id,
            n.status,
            n.final_value,
            n.buyer_client_id,
            ROW_NUMBER() OVER (
              PARTITION BY n.property_id
              ORDER BY n.version DESC, n.id DESC
            ) AS rn
          FROM negotiations n
          WHERE n.status NOT IN (?, ?, ?, ?, ?)
        ) ranked
        WHERE ranked.rn = 1
      ) an ON an.property_id = p.id
      LEFT JOIN users nbu ON nbu.id = an.buyer_client_id
      LEFT JOIN property_edit_requests per
        ON per.property_id = p.id
       AND per.status = 'PENDING'
      LEFT JOIN property_images pi ON pi.property_id = p.id
      WHERE p.id = ?
        ${publicOnly ? "AND p.status = 'approved' AND COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'" : ''}
      GROUP BY p.id
    `,
    [...NEGOTIATION_TERMINAL_STATUSES, propertyId]
  );

  return rows?.[0] ?? null;
}

class PropertyController {
  async show(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const property = await fetchPropertyAggregateById(propertyId);

      if (!property) {
        return res.status(404).json({ error: "Imóvel não encontrado." });
      }
      const isOwner =
        (property.broker_id != null && property.broker_id === (req as AuthRequest).userId) ||
        (property.owner_id != null && property.owner_id === (req as AuthRequest).userId);
      const isAdmin = (req as AuthRequest).userRole === 'admin';
      const isCapturingBrokerOwner =
        property.broker_id != null && property.broker_id === (req as AuthRequest).userId;
      const isPubliclyVisible =
        property.status === 'approved' &&
        String(property.visibility ?? 'PUBLIC').toUpperCase() === 'PUBLIC';
      if (property.status === 'pending_approval' && !isAdmin && !isCapturingBrokerOwner) {
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
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: "Identificador de imóvel inválido." });
    }

    try {
      const property = await fetchPropertyAggregateById(propertyId, {
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
    const brokerId = req.userId;

    if (!brokerId) {
      return res.status(401).json({ error: "Corretor não autenticado." });
    }

    const createPayload = req.body ?? {};
    const {
      title,
      description,
      type,
      purpose,
      is_promoted,
      promo_percentage,
      promo_start_date,
      promo_end_date,
      promotion_percentage,
      promotion_start,
      promotion_end,
      price,
      price_sale,
      price_rent,
      promotion_price,
      promotional_price,
      promotional_rent_price,
      promotional_rent_percentage,
      code,
      owner_name,
      owner_phone,
      address,
      quadra,
      lote,
      numero,
      sem_numero,
      bairro,
      complemento,
      city,
      state,
      cep,
      sem_cep,
      bedrooms,
      bathrooms,
      area_construida,
      area_terreno,
      area,
      garage_spots,
      amenities,
      amenityIds,
      amenity_ids,
      featureIds,
      feature_ids,
      features,
      has_wifi,
      tem_piscina,
      tem_energia_solar,
      tem_automacao,
      tem_ar_condicionado,
      eh_mobiliada,
      valor_condominio,
      valor_iptu,
      sem_quadra,
      sem_lote,
      area_construida_unidade,
    } = createPayload;
    const semNumeroFlag = parseBoolean(sem_numero);
    const semQuadraFlag = parseBoolean(sem_quadra);
    const semLoteFlag = parseBoolean(sem_lote);
    const semCepFlag = parseBoolean(sem_cep);
    const hasBedrooms = Object.prototype.hasOwnProperty.call(createPayload, "bedrooms");
    const hasBathrooms = Object.prototype.hasOwnProperty.call(createPayload, "bathrooms");
    const hasGarageSpots = Object.prototype.hasOwnProperty.call(createPayload, "garage_spots");

    let normalizedAmenities: string[] = [];
    try {
      normalizedAmenities = normalizePropertyAmenities(
        amenities ??
          amenityIds ??
          amenity_ids ??
          featureIds ??
          feature_ids ??
          features ??
          null
      );
    } catch (amenityError) {
      logPropertyCreateValidationFailure(req, "broker", "amenity_parse_error", {
        error: (amenityError as Error).message,
      });
      return res.status(400).json({ error: (amenityError as Error).message });
    }

    const normalizedDescription = normalizePropertyDescription(String(description ?? ""));

    if (!title || !description || !type || !purpose || !address || !city || !state) {
      logPropertyCreateValidationFailure(req, "broker", "missing_required_fields", {
        title: Boolean(title),
        descriptionLength: normalizedDescription.length,
        type: Boolean(type),
        purpose: Boolean(purpose),
        address: Boolean(address),
        city: Boolean(city),
        state: Boolean(state),
      });
      return res.status(400).json({ error: "Campos obrigatórios não informados." });
    }

    if (!hasValidPropertyDescription(description)) {
      logPropertyCreateValidationFailure(req, "broker", "invalid_description_length", {
        descriptionLength: normalizedDescription.length,
        rawDescriptionLength: String(description ?? "").trim().length,
      });
      return res.status(400).json({
        error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
      });
    }

    const normalizedType = normalizePropertyType(type);
    if (!normalizedType) {
      return res.status(400).json({ error: "Tipo de imóvel inválido." });
    }

    const normalizedPurpose = normalizePurpose(purpose);
    if (!normalizedPurpose) {
      return res.status(400).json({ error: "Finalidade do imóvel invalida." });
    }

    const requiredBairroError = validateRequiredBairro(bairro, normalizedType);
    if (requiredBairroError) {
      return res.status(400).json({ error: requiredBairroError });
    }

    const createTextValidationError = [
      validateMaxTextLength(title, 'Título'),
      validateMaxTextLength(owner_name, 'Nome do proprietário'),
      validateMaxTextLength(address, 'Endereço'),
      validateMaxTextLength(numero, 'Número', 25),
      validateMaxTextLength(bairro, 'Bairro'),
      validateMaxTextLength(complemento, 'Complemento'),
      validateMaxTextLength(city, 'Cidade'),
      ...(semQuadraFlag ? [] : [validateMaxTextLength(quadra, 'Quadra', 25)]),
      ...(semLoteFlag ? [] : [validateMaxTextLength(lote, 'Lote', 25)]),
      validateMaxTextLength(code, 'Código'),
    ].find(Boolean);

    if (createTextValidationError) {
      logPropertyCreateValidationFailure(req, "broker", "text_validation_error", {
        error: createTextValidationError,
      });
      return res.status(400).json({ error: createTextValidationError });
    }

    if (owner_phone && String(owner_phone).trim().length > 0) {
      const ownerPhoneDigits = String(owner_phone).replace(/\D/g, "");
      if (ownerPhoneDigits.length < 10 || ownerPhoneDigits.length > 13) {
        logPropertyCreateValidationFailure(req, "broker", "invalid_owner_phone", {
          digitsLength: ownerPhoneDigits.length,
        });
        return res.status(400).json({
          error: "Telefone do proprietário inválido.",
        });
      }
    }
    const numeroNormalizado = normalizeAddressNumberForPersistence(numero, semNumeroFlag);

    let promotionFlag: 0 | 1 = 0;
    let promotionPercentage: number | null = null;
    let promotionalRentPercentage: number | null = null;
    let promotionStartDate: string | null = null;
    let promotionEndDate: string | null = null;
    let promotionStart: string | null = null;
    let promotionEnd: string | null = null;
    try {
      const promotionPercentageInput = promo_percentage ?? promotion_percentage;
      const promotionalRentPercentageInput = promotional_rent_percentage;
      const promotionStartInput = promo_start_date ?? promotion_start;
      const promotionEndInput = promo_end_date ?? promotion_end;
      promotionFlag = parseBoolean(is_promoted);
      promotionPercentage = parsePromotionPercentage(promotionPercentageInput);
      promotionalRentPercentage = parsePromotionPercentage(
        promotionalRentPercentageInput
      );
      promotionStartDate = parsePromotionDate(promotionStartInput);
      promotionEndDate = parsePromotionDate(promotionEndInput);
      promotionStart = parsePromotionDateTime(promotionStartInput);
      promotionEnd = parsePromotionDateTime(promotionEndInput);
      if (promotionFlag === 0) {
        promotionPercentage = null;
        promotionalRentPercentage = null;
        promotionStartDate = null;
        promotionEndDate = null;
        promotionStart = null;
        promotionEnd = null;
      }
    } catch (parseError) {
      logPropertyCreateValidationFailure(req, "broker", "promotion_parse_error", {
        message: (parseError as Error).message,
      });
      return res.status(400).json({ error: (parseError as Error).message });
    }

    let numericPrice: number;
    let numericPriceSale: number | null = null;
    let numericPriceRent: number | null = null;
    let numericPromotionPrice: number | null = null;
    let numericPromotionalRentPrice: number | null = null;
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
      numericPromotionPrice =
        parseOptionalPrice(promotion_price ?? promotional_price) ?? null;
      numericPromotionalRentPrice =
        parseOptionalPrice(promotional_rent_price) ?? null;

      if (normalizedPurpose === "Venda") {
        numericPromotionalRentPrice = null;
        promotionalRentPercentage = null;
      } else if (normalizedPurpose === "Aluguel") {
        numericPromotionPrice = null;
        promotionPercentage = null;
      }

      if (
        numericPromotionPrice == null &&
        promotionPercentage != null &&
        numericPriceSale != null
      ) {
        numericPromotionPrice = Number(
          (numericPriceSale * (1 - promotionPercentage / 100)).toFixed(2)
        );
      }

      if (
        numericPromotionalRentPrice == null &&
        promotionalRentPercentage != null &&
        numericPriceRent != null
      ) {
        numericPromotionalRentPrice = Number(
          (numericPriceRent * (1 - promotionalRentPercentage / 100)).toFixed(2)
        );
      }

      if (
        numericPromotionPrice != null &&
        numericPriceSale != null &&
        numericPromotionPrice >= numericPriceSale
      ) {
        return res.status(400).json({
          error: "Preço promocional de venda deve ser menor que o preço de venda.",
        });
      }

      if (
        numericPromotionalRentPrice != null &&
        numericPriceRent != null &&
        numericPromotionalRentPrice >= numericPriceRent
      ) {
        return res.status(400).json({
          error:
            "Preço promocional de aluguel deve ser menor que o preço de aluguel.",
        });
      }

      if (numericPromotionPrice != null || numericPromotionalRentPrice != null) {
        promotionFlag = 1;
      }
      if (promotionPercentage != null || promotionalRentPercentage != null) {
        promotionFlag = 1;
      }
    } catch (parseError) {
      logPropertyCreateValidationFailure(req, "broker", "price_parse_error", {
        message: (parseError as Error).message,
      });
      return res.status(400).json({ error: (parseError as Error).message });
    }

    try {
      const brokerRows = await runPropertyQuery<RowDataPacket[]>(
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

      const effectiveQuadra = semQuadraFlag ? null : stringOrNull(quadra);
      const effectiveLote = semLoteFlag ? null : stringOrNull(lote);

      const duplicateRows = await runPropertyQuery<RowDataPacket[]>(
        `
          SELECT id FROM properties
          WHERE address = ?
            AND COALESCE(quadra, '') = COALESCE(?, '')
            AND COALESCE(lote, '') = COALESCE(?, '')
            AND COALESCE(numero, '') = COALESCE(?, '')
            AND COALESCE(bairro, '') = COALESCE(?, '')
          LIMIT 1
        `,
        [address, effectiveQuadra, effectiveLote, numeroNormalizado, bairro ?? null]
      );

      if (duplicateRows.length > 0) {
        return res
          .status(409)
          .json({ error: 'Imóvel já cadastrado no sistema.' });
      }

      let numericBedrooms: number | null;
      let numericBathrooms: number | null;
      let numericGarageSpots: number | null;
      let areaUnidade: AreaConstruidaUnidade;
      let numericAreaConstruida: number | null = null;
      let numericAreaTerreno: number | null = null;
      let numericValorCondominio: number | null = null;
      let numericValorIptu: number | null = null;

      try {
        numericBedrooms = normalizeNumericCountField(bedrooms, {
          label: "Quartos",
          required: true,
          hasField: hasBedrooms,
        });
        numericBathrooms = normalizeNumericCountField(bathrooms, {
          label: "Banheiros",
          required: true,
          hasField: hasBathrooms,
        });
        numericGarageSpots = normalizeNumericCountField(garage_spots, {
          label: "Garagens",
          required: true,
          hasField: hasGarageSpots,
        });
        areaUnidade = normalizeAreaUnidade(
          typeof area_construida_unidade === 'string' ? area_construida_unidade : 'm2',
        );
        const rawAreaInput = parseDecimal(area_construida ?? area);
        if (rawAreaInput != null) {
          const converted = areaInputToSquareMeters(rawAreaInput, areaUnidade);
          if (Number.isNaN(converted)) {
            return res.status(400).json({ error: 'Área construída inválida.' });
          }
          numericAreaConstruida = converted;
        }
        numericAreaTerreno = parseDecimal(area_terreno);
        numericValorCondominio = parseDecimal(valor_condominio);
        numericValorIptu = parseDecimal(valor_iptu);
      } catch (parseError) {
        logPropertyCreateValidationFailure(req, "broker", "numeric_parse_error", {
          message: (parseError as Error).message,
        });
        return res.status(400).json({ error: (parseError as Error).message });
      }

      const numericValidationError = [
        validatePropertyNumericRange(numericPrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
        validatePropertyNumericRange(numericPriceSale, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericPriceRent, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericBedrooms, 'Quartos', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericBathrooms, 'Banheiros', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericGarageSpots, 'Garagens', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericAreaConstruida, 'Área construída', { max: MAX_PROPERTY_AREA }),
        validatePropertyNumericRange(numericAreaTerreno, 'Área do terreno', { max: MAX_PROPERTY_AREA }),
        validatePropertyNumericRange(numericValorCondominio, 'Valor de condomínio', { max: MAX_PROPERTY_FEE, allowNull: true }),
        validatePropertyNumericRange(numericValorIptu, 'Valor de IPTU', { max: MAX_PROPERTY_FEE, allowNull: true }),
      ].find(Boolean);

      if (numericValidationError) {
        logPropertyCreateValidationFailure(req, "broker", "numeric_validation_error", {
          error: numericValidationError,
        });
        return res.status(400).json({ error: numericValidationError });
      }

      const hasWifiFlag = parseBoolean(has_wifi);
      const temPiscinaFlag = parseBoolean(tem_piscina);
      const temEnergiaSolarFlag = parseBoolean(tem_energia_solar);
      const temAutomacaoFlag = parseBoolean(tem_automacao);
      const temArCondicionadoFlag = parseBoolean(tem_ar_condicionado);
      const ehMobiliadaFlag = parseBoolean(eh_mobiliada);

      const imageUrls: string[] = [];
      const files = req.files ?? {};

      const imageFiles = files.images ?? [];
      const bodyImages = req.body?.images
        ? (Array.isArray(req.body.images) ? req.body.images : [req.body.images])
            .filter((v: unknown) => typeof v === 'string' && String(v).startsWith('http'))
        : [];

      if (imageFiles.length + bodyImages.length < 1) {
        logPropertyCreateValidationFailure(req, "broker", "missing_images");
        return res.status(400).json({ error: 'Envie pelo menos 1 imagem do imóvel.' });
      }
      if (imageFiles.length + bodyImages.length > MAX_IMAGES_PER_PROPERTY) {
        return res.status(400).json({
          error: `Limite maximo de ${MAX_IMAGES_PER_PROPERTY} imagens por imovel.`,
        });
      }

      imageUrls.push(...bodyImages);

      for (const file of imageFiles) {
        const uploaded = await uploadToCloudinary(file, 'properties');
        imageUrls.push(uploaded.url);
      }

      let videoUrl: string | null = req.body?.video && typeof req.body.video === 'string' && req.body.video.startsWith('http') ? req.body.video : null;
      if (files.video && files.video[0]) {
        const uploadedVideo = await uploadToCloudinary(files.video[0], 'videos');
        videoUrl = uploadedVideo.url;
      }

      const trimmedBrokerPropertyCode = String(code ?? '').trim();
      const resolvedBrokerPropertyCode =
        trimmedBrokerPropertyCode.length > 0
          ? trimmedBrokerPropertyCode
          : await allocateNextPropertyCode();

      const result = await runPropertyQuery<ResultSetHeader>(
        `
          INSERT INTO properties (
            broker_id,
            owner_id,
            title,
            description,
            type,
            purpose,
            status,
            is_promoted,
            promotion_percentage,
            promotion_start,
            promotion_end,
            promo_percentage,
            promo_start_date,
            promo_end_date,
            price,
            price_sale,
            price_rent,
            promotion_price,
            promotional_rent_price,
            promotional_rent_percentage,
            code,
            owner_name,
            owner_phone,
            address,
            quadra,
            sem_quadra,
            lote,
            sem_lote,
            numero,
            bairro,
            complemento,
            city,
            state,
            cep,
            sem_cep,
            bedrooms,
            bathrooms,
            area_construida,
            area_construida_unidade,
            area_terreno,
            garage_spots,
            amenities,
            has_wifi,
            tem_piscina,
            tem_energia_solar,
            tem_automacao,
            tem_ar_condicionado,
            eh_mobiliada,
            valor_condominio,
            valor_iptu,
            video_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          brokerId,
          null,
          title,
          normalizedDescription,
          normalizedType,
          normalizedPurpose,
          'pending_approval',
          promotionFlag,
          promotionPercentage,
          promotionStart,
          promotionEnd,
          promotionPercentage,
          promotionStartDate,
          promotionEndDate,
          numericPrice,
          numericPriceSale,
          numericPriceRent,
          numericPromotionPrice,
          numericPromotionalRentPrice,
          promotionalRentPercentage,
          resolvedBrokerPropertyCode,
          stringOrNull(owner_name),
          stringOrNull(owner_phone)?.replace(/\D/g, '') ?? null,
          address,
          effectiveQuadra,
          semQuadraFlag,
          effectiveLote,
          semLoteFlag,
          numeroNormalizado,
          stringOrNull(bairro),
          stringOrNull(complemento),
          city,
          state,
          normalizeCepForPersistence(cep, semCepFlag),
          semCepFlag,
          numericBedrooms,
          numericBathrooms,
          numericAreaConstruida,
          areaUnidade,
          numericAreaTerreno,
          numericGarageSpots,
          normalizedAmenities.length > 0 ? JSON.stringify(normalizedAmenities) : null,
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
        await runPropertyQuery(
          'INSERT INTO property_images (property_id, image_url) VALUES ?',
          [values]
        );
      }

      if (promotionFlag === 1) {
        try {
          await notifyPromotionStarted({
            propertyId,
            propertyTitle: title,
            promotionPercentage,
          });
        } catch (promotionNotifyError) {
          console.error('Erro ao notificar favoritos sobre promocao (create broker):', promotionNotifyError);
        }
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
      const knownError = error as { statusCode?: number } | null;
      const message = error instanceof Error ? error.message : '';
      if (knownError?.statusCode === 413) {
        return res.status(413).json({
          error: 'Arquivo muito grande. Reduza o tamanho das imagens e tente novamente.',
        });
      }
      if (message.includes("Out of range value for column 'price'")) {
        return res.status(400).json({
          error: 'Preço fora do limite permitido para o banco de dados. Reduza o valor e tente novamente.',
        });
      }
      if (message.includes("Data truncated for column 'type'")) {
        return res.status(400).json({
          error: 'O tipo do imóvel não é aceito pelo schema atual do banco. Reinicie o backend para aplicar as migrations.',
        });
      }
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async createForClient(req: AuthRequestWithFiles, res: Response) {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const createClientPayload = req.body ?? {};

    const {
      title,
      description,
      type,
      purpose,
      is_promoted,
      promo_percentage,
      promo_start_date,
      promo_end_date,
      promotion_percentage,
      promotion_start,
      promotion_end,
      price,
      price_sale,
      price_rent,
      promotion_price,
      promotional_price,
      promotional_rent_price,
      promotional_rent_percentage,
      code,
      owner_name,
      owner_phone,
      address,
      quadra,
      lote,
      numero,
      sem_numero,
      bairro,
      complemento,
      city,
      state,
      cep,
      sem_cep,
      bedrooms,
      bathrooms,
      area_construida,
      area_terreno,
      area,
      garage_spots,
      amenities,
      amenityIds,
      amenity_ids,
      featureIds,
      feature_ids,
      features,
      has_wifi,
      tem_piscina,
      tem_energia_solar,
      tem_automacao,
      tem_ar_condicionado,
      eh_mobiliada,
      valor_condominio,
      valor_iptu,
      sem_quadra,
      sem_lote,
      area_construida_unidade,
    } = createClientPayload;
    const semNumeroFlag = parseBoolean(sem_numero);
    const semQuadraFlag = parseBoolean(sem_quadra);
    const semLoteFlag = parseBoolean(sem_lote);
    const semCepFlag = parseBoolean(sem_cep);
    const hasBedrooms = Object.prototype.hasOwnProperty.call(createClientPayload, "bedrooms");
    const hasBathrooms = Object.prototype.hasOwnProperty.call(createClientPayload, "bathrooms");
    const hasGarageSpots = Object.prototype.hasOwnProperty.call(createClientPayload, "garage_spots");

    let normalizedAmenities: string[] = [];
    try {
      normalizedAmenities = normalizePropertyAmenities(
        amenities ??
          amenityIds ??
          amenity_ids ??
          featureIds ??
          feature_ids ??
          features ??
          null
      );
    } catch (amenityError) {
      logPropertyCreateValidationFailure(req, "client", "amenity_parse_error", {
        error: (amenityError as Error).message,
      });
      return res.status(400).json({ error: (amenityError as Error).message });
    }

    const normalizedDescription = normalizePropertyDescription(String(description ?? ""));

    if (!title || !description || !type || !purpose || !address || !city || !state) {
      logPropertyCreateValidationFailure(req, "client", "missing_required_fields", {
        title: Boolean(title),
        descriptionLength: normalizedDescription.length,
        type: Boolean(type),
        purpose: Boolean(purpose),
        address: Boolean(address),
        city: Boolean(city),
        state: Boolean(state),
      });
      return res.status(400).json({ error: 'Campos obrigatórios não informados.' });
    }

    if (!hasValidPropertyDescription(description)) {
      logPropertyCreateValidationFailure(req, "client", "invalid_description_length", {
        descriptionLength: normalizedDescription.length,
        rawDescriptionLength: String(description ?? "").trim().length,
      });
      return res.status(400).json({
        error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
      });
    }

    const normalizedType = normalizePropertyType(type);
    if (!normalizedType) {
      return res.status(400).json({ error: 'Tipo de imóvel inválido.' });
    }

    const normalizedPurpose = normalizePurpose(purpose);
    if (!normalizedPurpose) {
      return res.status(400).json({ error: 'Finalidade do imovel invalida.' });
    }

    const requiredBairroError = validateRequiredBairro(bairro, normalizedType);
    if (requiredBairroError) {
      return res.status(400).json({ error: requiredBairroError });
    }

    const createClientTextValidationError = [
      validateMaxTextLength(title, 'Título'),
      validateMaxTextLength(owner_name, 'Nome do proprietário'),
      validateMaxTextLength(address, 'Endereço'),
      validateMaxTextLength(numero, 'Número', 25),
      validateMaxTextLength(bairro, 'Bairro'),
      validateMaxTextLength(complemento, 'Complemento'),
      validateMaxTextLength(city, 'Cidade'),
      ...(semQuadraFlag ? [] : [validateMaxTextLength(quadra, 'Quadra', 25)]),
      ...(semLoteFlag ? [] : [validateMaxTextLength(lote, 'Lote', 25)]),
      validateMaxTextLength(code, 'Código'),
    ].find(Boolean);

    if (createClientTextValidationError) {
      logPropertyCreateValidationFailure(req, "client", "text_validation_error", {
        error: createClientTextValidationError,
      });
      return res.status(400).json({ error: createClientTextValidationError });
    }

    if (owner_phone && String(owner_phone).trim().length > 0) {
      const ownerPhoneDigits = String(owner_phone).replace(/\D/g, '');
      if (ownerPhoneDigits.length < 10 || ownerPhoneDigits.length > 13) {
        logPropertyCreateValidationFailure(req, "client", "invalid_owner_phone", {
          digitsLength: ownerPhoneDigits.length,
        });
        return res.status(400).json({
          error: 'Telefone do proprietário inválido.',
        });
      }
    }
    const numeroNormalizado = normalizeAddressNumberForPersistence(numero, semNumeroFlag);

    let promotionFlag: 0 | 1 = 0;
    let promotionPercentage: number | null = null;
    let promotionalRentPercentage: number | null = null;
    let promotionStartDate: string | null = null;
    let promotionEndDate: string | null = null;
    let promotionStart: string | null = null;
    let promotionEnd: string | null = null;
    try {
      const promotionPercentageInput = promo_percentage ?? promotion_percentage;
      const promotionalRentPercentageInput = promotional_rent_percentage;
      const promotionStartInput = promo_start_date ?? promotion_start;
      const promotionEndInput = promo_end_date ?? promotion_end;
      promotionFlag = parseBoolean(is_promoted);
      promotionPercentage = parsePromotionPercentage(promotionPercentageInput);
      promotionalRentPercentage = parsePromotionPercentage(
        promotionalRentPercentageInput
      );
      promotionStartDate = parsePromotionDate(promotionStartInput);
      promotionEndDate = parsePromotionDate(promotionEndInput);
      promotionStart = parsePromotionDateTime(promotionStartInput);
      promotionEnd = parsePromotionDateTime(promotionEndInput);
      if (promotionFlag === 0) {
        promotionPercentage = null;
        promotionalRentPercentage = null;
        promotionStartDate = null;
        promotionEndDate = null;
        promotionStart = null;
        promotionEnd = null;
      }
    } catch (parseError) {
      logPropertyCreateValidationFailure(req, "client", "promotion_parse_error", {
        message: (parseError as Error).message,
      });
      return res.status(400).json({ error: (parseError as Error).message });
    }

    let numericPrice: number;
    let numericPriceSale: number | null = null;
    let numericPriceRent: number | null = null;
    let numericPromotionPrice: number | null = null;
    let numericPromotionalRentPrice: number | null = null;
    try {
      if (normalizedPurpose === 'Venda') {
        numericPriceSale = parseOptionalPrice(price_sale) ?? parsePrice(price);
        numericPrice = numericPriceSale;
      } else if (normalizedPurpose === 'Aluguel') {
        numericPriceRent = parseOptionalPrice(price_rent) ?? parsePrice(price);
        numericPrice = numericPriceRent;
      } else {
        numericPriceSale = parseOptionalPrice(price_sale);
        numericPriceRent = parseOptionalPrice(price_rent);
        if (numericPriceSale == null || numericPriceRent == null) {
          return res.status(400).json({
            error: 'Informe os precos de venda e aluguel para esta finalidade.',
          });
        }
        numericPrice = numericPriceSale;
      }
      numericPromotionPrice =
        parseOptionalPrice(promotion_price ?? promotional_price) ?? null;
      numericPromotionalRentPrice =
        parseOptionalPrice(promotional_rent_price) ?? null;

      if (normalizedPurpose === 'Venda') {
        numericPromotionalRentPrice = null;
        promotionalRentPercentage = null;
      } else if (normalizedPurpose === 'Aluguel') {
        numericPromotionPrice = null;
        promotionPercentage = null;
      }

      if (
        numericPromotionPrice == null &&
        promotionPercentage != null &&
        numericPriceSale != null
      ) {
        numericPromotionPrice = Number(
          (numericPriceSale * (1 - promotionPercentage / 100)).toFixed(2)
        );
      }

      if (
        numericPromotionalRentPrice == null &&
        promotionalRentPercentage != null &&
        numericPriceRent != null
      ) {
        numericPromotionalRentPrice = Number(
          (numericPriceRent * (1 - promotionalRentPercentage / 100)).toFixed(2)
        );
      }

      if (
        numericPromotionPrice != null &&
        numericPriceSale != null &&
        numericPromotionPrice >= numericPriceSale
      ) {
        return res.status(400).json({
          error: 'Preço promocional de venda deve ser menor que o preço de venda.',
        });
      }

      if (
        numericPromotionalRentPrice != null &&
        numericPriceRent != null &&
        numericPromotionalRentPrice >= numericPriceRent
      ) {
        return res.status(400).json({
          error: 'Preço promocional de aluguel deve ser menor que o preço de aluguel.',
        });
      }

      if (numericPromotionPrice != null || numericPromotionalRentPrice != null) {
        promotionFlag = 1;
      }
      if (promotionPercentage != null || promotionalRentPercentage != null) {
        promotionFlag = 1;
      }
    } catch (parseError) {
      logPropertyCreateValidationFailure(req, "client", "price_parse_error", {
        message: (parseError as Error).message,
      });
      return res.status(400).json({ error: (parseError as Error).message });
    }

    try {
      const effectiveQuadra = semQuadraFlag ? null : stringOrNull(quadra);
      const effectiveLote = semLoteFlag ? null : stringOrNull(lote);

      const duplicateRows = await runPropertyQuery<RowDataPacket[]>(
        `
          SELECT id FROM properties
          WHERE address = ?
            AND COALESCE(quadra, '') = COALESCE(?, '')
            AND COALESCE(lote, '') = COALESCE(?, '')
            AND COALESCE(numero, '') = COALESCE(?, '')
            AND COALESCE(bairro, '') = COALESCE(?, '')
          LIMIT 1
        `,
        [address, effectiveQuadra, effectiveLote, numeroNormalizado, bairro ?? null]
      );

      if (duplicateRows.length > 0) {
        return res
          .status(409)
          .json({ error: 'Imovel ja cadastrado no sistema.' });
      }

      let numericBedrooms: number | null;
      let numericBathrooms: number | null;
      let numericGarageSpots: number | null;
      let areaUnidade: AreaConstruidaUnidade;
      let numericAreaConstruida: number | null = null;
      let numericAreaTerreno: number | null = null;
      let numericValorCondominio: number | null = null;
      let numericValorIptu: number | null = null;

      try {
        numericBedrooms = normalizeNumericCountField(bedrooms, {
          label: "Quartos",
          required: true,
          hasField: hasBedrooms,
        });
        numericBathrooms = normalizeNumericCountField(bathrooms, {
          label: "Banheiros",
          required: true,
          hasField: hasBathrooms,
        });
        numericGarageSpots = normalizeNumericCountField(garage_spots, {
          label: "Garagens",
          required: true,
          hasField: hasGarageSpots,
        });
        areaUnidade = normalizeAreaUnidade(
          typeof area_construida_unidade === 'string' ? area_construida_unidade : 'm2',
        );
        const rawAreaInput = parseDecimal(area_construida ?? area);
        if (rawAreaInput != null) {
          const converted = areaInputToSquareMeters(rawAreaInput, areaUnidade);
          if (Number.isNaN(converted)) {
            return res.status(400).json({ error: 'Área construída inválida.' });
          }
          numericAreaConstruida = converted;
        }
        numericAreaTerreno = parseDecimal(area_terreno);
        numericValorCondominio = parseDecimal(valor_condominio);
        numericValorIptu = parseDecimal(valor_iptu);
      } catch (parseError) {
        logPropertyCreateValidationFailure(req, "client", "numeric_parse_error", {
          message: (parseError as Error).message,
        });
        return res.status(400).json({ error: (parseError as Error).message });
      }

      const numericValidationError = [
        validatePropertyNumericRange(numericPrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
        validatePropertyNumericRange(numericPriceSale, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericPriceRent, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
          validatePropertyNumericRange(numericBedrooms, 'Quartos', { max: MAX_PROPERTY_COUNT }),
          validatePropertyNumericRange(numericBathrooms, 'Banheiros', { max: MAX_PROPERTY_COUNT }),
          validatePropertyNumericRange(numericGarageSpots, 'Garagens', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericAreaConstruida, 'Área construída', { max: MAX_PROPERTY_AREA }),
        validatePropertyNumericRange(numericAreaTerreno, 'Área do terreno', { max: MAX_PROPERTY_AREA }),
        validatePropertyNumericRange(numericValorCondominio, 'Valor de condomínio', { max: MAX_PROPERTY_FEE, allowNull: true }),
        validatePropertyNumericRange(numericValorIptu, 'Valor de IPTU', { max: MAX_PROPERTY_FEE, allowNull: true }),
      ].find(Boolean);

      if (numericValidationError) {
        logPropertyCreateValidationFailure(req, "client", "numeric_validation_error", {
          error: numericValidationError,
        });
        return res.status(400).json({ error: numericValidationError });
      }

      const hasWifiFlag = parseBoolean(has_wifi);
      const temPiscinaFlag = parseBoolean(tem_piscina);
      const temEnergiaSolarFlag = parseBoolean(tem_energia_solar);
      const temAutomacaoFlag = parseBoolean(tem_automacao);
      const temArCondicionadoFlag = parseBoolean(tem_ar_condicionado);
      const ehMobiliadaFlag = parseBoolean(eh_mobiliada);

      const imageUrls: string[] = [];
      const files = req.files ?? {};

      const imageFiles = files.images ?? [];
      const bodyImages = req.body?.images
        ? (Array.isArray(req.body.images) ? req.body.images : [req.body.images])
            .filter((v: unknown) => typeof v === 'string' && String(v).startsWith('http'))
        : [];

      if (imageFiles.length + bodyImages.length < 1) {
        logPropertyCreateValidationFailure(req, "client", "missing_images");
        return res.status(400).json({ error: 'Envie pelo menos 1 imagem do imovel.' });
      }
      if (imageFiles.length + bodyImages.length > MAX_IMAGES_PER_PROPERTY) {
        return res.status(400).json({
          error: `Limite maximo de ${MAX_IMAGES_PER_PROPERTY} imagens por imovel.`,
        });
      }

      imageUrls.push(...bodyImages);

      for (const file of imageFiles) {
        const uploaded = await uploadToCloudinary(file, 'properties');
        imageUrls.push(uploaded.url);
      }

      let videoUrl: string | null = req.body?.video && typeof req.body.video === 'string' && req.body.video.startsWith('http') ? req.body.video : null;
      if (files.video && files.video[0]) {
        const uploadedVideo = await uploadToCloudinary(files.video[0], 'videos');
        videoUrl = uploadedVideo.url;
      }

      const trimmedClientPropertyCode = String(code ?? '').trim();
      const resolvedClientPropertyCode =
        trimmedClientPropertyCode.length > 0
          ? trimmedClientPropertyCode
          : await allocateNextPropertyCode();

      const result = await runPropertyQuery<ResultSetHeader>(
        `
          INSERT INTO properties (
            broker_id,
            owner_id,
            title,
            description,
            type,
            purpose,
            status,
            is_promoted,
            promotion_percentage,
            promotion_start,
            promotion_end,
            promo_percentage,
            promo_start_date,
            promo_end_date,
            price,
            price_sale,
            price_rent,
            promotion_price,
            promotional_rent_price,
            promotional_rent_percentage,
            code,
            owner_name,
            owner_phone,
            address,
            quadra,
            sem_quadra,
            lote,
            sem_lote,
            numero,
            bairro,
            complemento,
            city,
            state,
            cep,
            sem_cep,
            bedrooms,
            bathrooms,
            area_construida,
            area_construida_unidade,
            area_terreno,
            garage_spots,
            amenities,
            has_wifi,
            tem_piscina,
            tem_energia_solar,
            tem_automacao,
            tem_ar_condicionado,
            eh_mobiliada,
            valor_condominio,
            valor_iptu,
            video_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          null,
          userId,
          title,
          normalizedDescription,
          normalizedType,
          normalizedPurpose,
          'pending_approval',
          promotionFlag,
          promotionPercentage,
          promotionStart,
          promotionEnd,
          promotionPercentage,
          promotionStartDate,
          promotionEndDate,
          numericPrice,
          numericPriceSale,
          numericPriceRent,
          numericPromotionPrice,
          numericPromotionalRentPrice,
          promotionalRentPercentage,
          resolvedClientPropertyCode,
          stringOrNull(owner_name),
          stringOrNull(owner_phone)?.replace(/\D/g, '') ?? null,
          address,
          effectiveQuadra,
          semQuadraFlag,
          effectiveLote,
          semLoteFlag,
          numeroNormalizado,
          stringOrNull(bairro),
          stringOrNull(complemento),
          city,
          state,
          normalizeCepForPersistence(cep, semCepFlag),
          semCepFlag,
          numericBedrooms,
          numericBathrooms,
          numericAreaConstruida,
          areaUnidade,
          numericAreaTerreno,
          numericGarageSpots,
          normalizedAmenities.length > 0 ? JSON.stringify(normalizedAmenities) : null,
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
        await runPropertyQuery(
          'INSERT INTO property_images (property_id, image_url) VALUES ?',
          [values]
        );
      }

      if (promotionFlag === 1) {
        try {
          await notifyPromotionStarted({
            propertyId,
            propertyTitle: title,
            promotionPercentage,
          });
        } catch (promotionNotifyError) {
          console.error('Erro ao notificar favoritos sobre promocao (create client):', promotionNotifyError);
        }
      }

      try {
        const ownerPhoneDigits = String(owner_phone ?? '').replace(/\D/g, '');
        const localPhoneDigits =
          ownerPhoneDigits.length >= 10 && ownerPhoneDigits.length <= 13 ? ownerPhoneDigits : null;
        let clientEmail: string | null = null;
        try {
          const [emailRows] = await runPropertyQuery<RowDataPacket[]>(
            'SELECT email FROM users WHERE id = ? LIMIT 1',
            [userId]
          );
          const rawEmail = String(emailRows?.[0]?.email ?? '').trim();
          clientEmail = rawEmail || null;
        } catch (emailError) {
          console.error('Falha ao carregar e-mail do cliente para notificação de anúncio:', emailError);
        }
        const whatsappDigits = localPhoneDigits
          ? localPhoneDigits.startsWith('55')
            ? localPhoneDigits
            : `55${localPhoneDigits}`
          : null;
        const whatsappUrl = whatsappDigits
          ? `https://wa.me/${whatsappDigits}`
          : null;

        await createAdminNotification({
          type: 'announcement',
          title: 'Aviso: cliente tentou anunciar imóvel',
          message: `Novo imóvel enviado por cliente: '${title}'.`,
          relatedEntityId: propertyId,
          metadata: {
            source: 'client_property_create',
            propertyId,
            propertyTitle: title,
            clientId: userId,
            clientName: owner_name ?? null,
            clientEmail,
            clientPhoneRaw: String(owner_phone ?? '').trim() || null,
            clientPhone: localPhoneDigits,
            whatsappUrl,
          },
        });
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre imovel de cliente:', notifyError);
      }

      return res.status(201).json({
        message: 'Imovel criado com sucesso!',
        propertyId,
        status: 'pending_approval',
        images: imageUrls,
        video: videoUrl,
      });
    } catch (error) {
      console.error('Erro ao criar imovel (cliente):', error);
      const knownError = error as { statusCode?: number } | null;
      const message = error instanceof Error ? error.message : '';
      if (knownError?.statusCode === 413) {
        return res.status(413).json({
          error: 'Arquivo muito grande. Reduza o tamanho das imagens e tente novamente.',
        });
      }
      if (message.includes("Out of range value for column 'price'")) {
        return res.status(400).json({
          error: 'Preço fora do limite permitido para o banco de dados. Reduza o valor e tente novamente.',
        });
      }
      if (message.includes("Data truncated for column 'type'")) {
        return res.status(400).json({
          error: 'O tipo do imóvel não é aceito pelo schema atual do banco. Reinicie o backend para aplicar as migrations.',
        });
      }
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async createEditRequest(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel invalido.' });
    }

    const payload = (req.body ?? {}) as Record<string, unknown>;
    const db = await getPropertyDbConnection();

    try {
      await db.beginTransaction();

      const [propertyRows] = await db.query<PropertyRow[]>(
        'SELECT * FROM properties WHERE id = ? LIMIT 1 FOR UPDATE',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        await db.rollback();
        return res.status(404).json({ error: 'Imóvel nao encontrado.' });
      }

      const property = propertyRows[0];
      const isOwner =
        (property.broker_id != null && property.broker_id === userId) ||
        (property.owner_id != null && property.owner_id === userId);

      if (!isOwner) {
        await db.rollback();
        return res.status(403).json({ error: 'Acesso nao autorizado a este imovel.' });
      }

      if (property.status === 'pending_approval') {
        await db.rollback();
        return res.status(409).json({
          error: 'Imóveis pendentes não podem solicitar edição até o fim da análise.',
        });
      }

      const [pendingRows] = await db.query<PropertyEditRequestRow[]>(
        `
          SELECT id, status
          FROM property_edit_requests
          WHERE property_id = ? AND status = 'PENDING'
          LIMIT 1
          FOR UPDATE
        `,
        [propertyId]
      );

      if (pendingRows.length > 0) {
        await db.rollback();
        return res.status(409).json({
          error: 'Este imóvel já possui uma solicitação de edição pendente.',
        });
      }

      const currentState = buildEditablePropertyState(property as Record<string, unknown>);
      const preparedPatch = preparePropertyEditPatch(payload, currentState);

      if (Object.keys(preparedPatch.diff).length === 0) {
        await db.rollback();
        return res.status(400).json({
          error: 'Nenhuma alteração válida foi identificada para enviar à aprovação.',
        });
      }

      const requesterRole = resolveEditRequesterRole(req);

      const [insertResult] = await db.query<ResultSetHeader>(
        `
          INSERT INTO property_edit_requests (
            property_id,
            requester_user_id,
            requester_role,
            status,
            before_json,
            after_json,
            diff_json,
            review_reason,
            reviewed_by,
            reviewed_at
          ) VALUES (
            ?,
            ?,
            ?,
            'PENDING',
            CAST(? AS JSON),
            CAST(? AS JSON),
            CAST(? AS JSON),
            NULL,
            NULL,
            NULL
          )
        `,
        [
          propertyId,
          userId,
          requesterRole,
          JSON.stringify(preparedPatch.before),
          JSON.stringify(preparedPatch.after),
          JSON.stringify(preparedPatch.diff),
        ]
      );

      if (property.status === 'rejected') {
        await db.query(
          `UPDATE properties SET
            status = 'pending_approval',
            rejection_reason = NULL,
            visibility = 'HIDDEN',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [propertyId]
        );
      }

      await db.commit();

      try {
        await notifyAdmins(
          `Nova solicitacao de edicao do imovel '${property.title}'.`,
          'property',
          propertyId
        );
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre solicitacao de edicao:', notifyError);
      }

      return res.status(202).json({
        message: 'Solicitação de edição enviada para aprovação.',
        requestId: insertResult.insertId,
        ...(property.status === 'rejected' ? { status: 'pending_approval' as const } : {}),
      });
    } catch (error) {
      await db.rollback();
      const message = error instanceof Error ? error.message : '';
      if (message) {
        return res.status(400).json({ error: message });
      }
      console.error('Erro ao criar solicitacao de edicao do imovel:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
      db.release();
    }
  }

  async update(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (req.userRole === 'client') {
      return res.status(403).json({
        error:
          'Clientes nao podem editar imovel diretamente. Envie uma solicitacao de edicao para aprovacao.',
      });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel invalido.' });
    }

    try {
      const propertyRows = await runPropertyQuery<PropertyRow[]>(
        'SELECT * FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imóvel nao encontrado.' });
      }

      const property = propertyRows[0];
      const brokerId = property.broker_id != null ? Number(property.broker_id) : null;

      const isOwner =
        (property.broker_id != null && property.broker_id === userId) ||
        (property.owner_id != null && property.owner_id === userId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Acesso nao autorizado a este imovel.' });
      }
      if (property.status === 'pending_approval') {
        return res.status(409).json({
          error: 'Imóveis pendentes não podem ser editados até o fim da análise.',
        });
      }

      const previousSalePrice =
        property.price_sale != null ? Number(property.price_sale) : Number(property.price);
      const previousRentPrice =
        property.price_rent != null ? Number(property.price_rent) : Number(property.price);
      const previousPromotionFlag = toBoolean(property.is_promoted);

      const body = req.body ?? {};
      const normalizedUpdateBody: Record<string, unknown> = {
        ...body,
      } as Record<string, unknown>;
      const rawAmenitiesForUpdate =
        body.amenities ??
        body.amenityIds ??
        body.amenity_ids ??
        body.featureIds ??
        body.feature_ids ??
        body.features ??
        null;
      if (rawAmenitiesForUpdate != null) {
        normalizedUpdateBody.amenities = rawAmenitiesForUpdate;
        delete normalizedUpdateBody.amenityIds;
        delete normalizedUpdateBody.amenity_ids;
        delete normalizedUpdateBody.featureIds;
        delete normalizedUpdateBody.feature_ids;
        delete normalizedUpdateBody.features;
      }
      const bodyKeys = Object.keys(normalizedUpdateBody);
      const semNumeroBody =
        normalizedUpdateBody.sem_numero !== undefined
          ? parseBoolean(normalizedUpdateBody.sem_numero)
          : null;
      const semCepBody =
        normalizedUpdateBody.sem_cep !== undefined
          ? parseBoolean(normalizedUpdateBody.sem_cep)
          : parseBoolean(property.sem_cep);

      const nextDescription = normalizePropertyDescription(
        String(normalizedUpdateBody.description ?? property.description ?? '')
      );
      if (!hasValidPropertyDescription(nextDescription)) {
        return res.status(400).json({
          error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
        });
      }

      const nextType = normalizePropertyType(normalizedUpdateBody.type) ?? property.type;
      const requiredBairroError = validateRequiredBairro(
        normalizedUpdateBody.bairro ?? property.bairro,
        nextType
      );
      if (requiredBairroError) {
        return res.status(400).json({ error: requiredBairroError });
      }

      const updateTextValidationError = [
        validateMaxTextLength(normalizedUpdateBody.title ?? property.title, 'Título'),
        validateMaxTextLength(normalizedUpdateBody.owner_name ?? property.owner_name, 'Nome do proprietário'),
        validateMaxTextLength(normalizedUpdateBody.address ?? property.address, 'Endereço'),
        validateMaxTextLength(normalizedUpdateBody.numero ?? property.numero, 'Número', 25),
        validateMaxTextLength(normalizedUpdateBody.bairro ?? property.bairro, 'Bairro'),
        validateMaxTextLength(normalizedUpdateBody.complemento ?? property.complemento, 'Complemento'),
        validateMaxTextLength(normalizedUpdateBody.city ?? property.city, 'Cidade'),
        validateMaxTextLength(normalizedUpdateBody.quadra ?? property.quadra, 'Quadra', 25),
        validateMaxTextLength(normalizedUpdateBody.lote ?? property.lote, 'Lote', 25),
        validateMaxTextLength(normalizedUpdateBody.code ?? property.code, 'Código'),
      ].find(Boolean);

      if (updateTextValidationError) {
        return res.status(400).json({ error: updateTextValidationError });
      }

      const nextPurpose = normalizePurpose(normalizedUpdateBody.purpose) ?? property.purpose;
      const purposeLower = String(nextPurpose ?? '').toLowerCase();
      const supportsSale = purposeLower.includes('vend');
      const supportsRent = purposeLower.includes('alug');
      let nextSalePrice = previousSalePrice;
      let nextRentPrice = previousRentPrice;
      let saleTouched = false;
      let rentTouched = false;
      let nextPromotionFlag = previousPromotionFlag ? 1 : 0;
      let nextPromotionPercentage =
        property.promo_percentage != null
          ? Number(property.promo_percentage)
          : property.promotion_percentage != null
            ? Number(property.promotion_percentage)
            : null;
      let nextPromotionPrice =
        property.promotion_price != null ? Number(property.promotion_price) : null;
      let nextPromotionalRentPrice =
        property.promotional_rent_price != null
          ? Number(property.promotional_rent_price)
          : null;
      let nextPromotionalRentPercentage =
        property.promotional_rent_percentage != null
          ? Number(property.promotional_rent_percentage)
          : null;

      // Always allow editing all fields, even if approved
      const updatableFields = new Set([
        'title',
        'description',
        'type',
        'purpose',
        'status',
        'price',
        'price_sale',
        'price_rent',
        'promotion_price',
        'promotional_price',
        'promotional_rent_price',
        'promotional_rent_percentage',
        'is_promoted',
        'promo_percentage',
        'promo_start_date',
        'promo_end_date',
        'promotion_percentage',
        'promotion_start',
        'promotion_end',
        'code',
        'owner_name',
        'owner_phone',
        'address',
        'quadra',
        'lote',
        'numero',
        'sem_numero',
        'bairro',
        'complemento',
        'city',
        'state',
        'cep',
        'sem_cep',
        'bedrooms',
        'bathrooms',
        'area_construida',
        'area_terreno',
        'garage_spots',
        'amenities',
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
            const normalized = normalizeStatus(normalizedUpdateBody.status);
            if (!normalized) {
              return res.status(400).json({ error: 'Status informado invalido.' });
            }
            nextStatus = normalized;
            fields.push('status = ?');
            values.push(normalized);
            break;
          }
          case 'purpose': {
            const normalized = normalizePurpose(normalizedUpdateBody.purpose);
            if (!normalized) {
              return res.status(400).json({ error: 'Finalidade informada e invalida.' });
            }
            fields.push('purpose = ?');
            values.push(normalized);
            break;
          }
          case 'type': {
            const normalized = normalizePropertyType(normalizedUpdateBody.type);
            if (!normalized) {
              return res.status(400).json({ error: 'Tipo de imóvel inválido.' });
            }
            fields.push('type = ?');
            values.push(normalized);
            break;
          }
          case 'price': {
            try {
              const parsed = parsePrice(normalizedUpdateBody.price);
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
              const parsed = parsePrice(normalizedUpdateBody[key]);
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
              const hasField = Object.prototype.hasOwnProperty.call(normalizedUpdateBody, key);
              const parsed = normalizeNumericCountField(normalizedUpdateBody[key], {
                label: key === 'garage_spots' ? 'Garagens' : key === 'bedrooms' ? 'Quartos' : 'Banheiros',
                hasField,
                required: false,
              });
              values.push(parsed);
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'amenities': {
            try {
              const normalizedAmenityList = normalizePropertyAmenities(normalizedUpdateBody.amenities);
              fields.push('amenities = ?');
              values.push(
                normalizedAmenityList.length > 0
                  ? JSON.stringify(normalizedAmenityList)
                  : null
              );
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
              values.push(parseDecimal(normalizedUpdateBody[key]));
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
            values.push(parseBoolean(normalizedUpdateBody[key]));
            break;
          }
          case 'is_promoted': {
            const parsed = parseBoolean(normalizedUpdateBody[key]);
            nextPromotionFlag = parsed;
            if (parsed === 0) {
              nextPromotionPercentage = null;
              nextPromotionPrice = null;
              nextPromotionalRentPrice = null;
              fields.push('promo_percentage = ?');
              values.push(null);
              fields.push('promo_start_date = ?');
              values.push(null);
              fields.push('promo_end_date = ?');
              values.push(null);
              fields.push('promotion_percentage = ?');
              values.push(null);
              fields.push('promotion_start = ?');
              values.push(null);
              fields.push('promotion_end = ?');
              values.push(null);
              fields.push('promotion_price = ?');
              values.push(null);
              fields.push('promotional_rent_price = ?');
              values.push(null);
              fields.push('promotional_rent_percentage = ?');
              values.push(null);
            }
            fields.push('is_promoted = ?');
            values.push(parsed);
            break;
          }
          case 'promo_percentage':
          case 'promotion_percentage': {
            try {
              const parsed = parsePromotionPercentage(normalizedUpdateBody[key]);
              nextPromotionPercentage = parsed;
              fields.push('promo_percentage = ?');
              values.push(parsed);
              fields.push('promotion_percentage = ?');
              values.push(parsed);
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'promotion_price':
          case 'promotional_price':
          case 'promotional_rent_price': {
            try {
              const parsed = parseOptionalPrice(normalizedUpdateBody[key]);
              if (key === 'promotional_rent_price') {
                fields.push('promotional_rent_price = ?');
                values.push(parsed);
                nextPromotionalRentPrice = parsed;
              } else {
                fields.push('promotion_price = ?');
                values.push(parsed);
                nextPromotionPrice = parsed;
              }
              if (parsed != null) {
                nextPromotionFlag = 1;
              }
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'promotional_rent_percentage': {
            try {
              const parsed = parsePromotionPercentage(normalizedUpdateBody[key]);
              fields.push('promotional_rent_percentage = ?');
              values.push(parsed);
              nextPromotionalRentPercentage = parsed;
              if (parsed != null) {
                nextPromotionFlag = 1;
              }
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'promo_start_date':
          case 'promotion_start':
          case 'promo_end_date':
          case 'promotion_end': {
            try {
              const parsedDate = parsePromotionDate(normalizedUpdateBody[key]);
              const parsedDateTime = parsePromotionDateTime(normalizedUpdateBody[key]);
              if (key === 'promotion_start' || key === 'promo_start_date') {
                fields.push('promo_start_date = ?');
                values.push(parsedDate);
                fields.push('promotion_start = ?');
                values.push(parsedDateTime);
              } else {
                fields.push('promo_end_date = ?');
                values.push(parsedDate);
                fields.push('promotion_end = ?');
                values.push(parsedDateTime);
              }
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'owner_phone': {
            const text = String(normalizedUpdateBody[key] ?? '').trim();
            if (text.length > 0) {
              const digits = text.replace(/\D/g, '');
              if (digits.length < 10 || digits.length > 13) {
                return res.status(400).json({ error: 'Telefone do proprietário inválido.' });
              }
              fields.push('owner_phone = ?');
              values.push(digits);
            } else {
              fields.push('owner_phone = ?');
              values.push(null);
            }
            break;
          }
          case 'sem_numero': {
            // `sem_numero` e uma flag de entrada; persistimos apenas `numero`.
            break;
          }
          case 'numero': {
            if (semNumeroBody === 1) {
              fields.push('numero = ?');
              values.push(null);
              break;
            }
            const rawNumero = String(normalizedUpdateBody.numero ?? '').trim();
            const numeroDigits = rawNumero.replace(/\D/g, '');
            if (rawNumero.length > 0 && numeroDigits.length === 0) {
              return res.status(400).json({ error: 'Número do endereço deve conter apenas dígitos.' });
            }
            fields.push('numero = ?');
            values.push(stringOrNull(numeroDigits));
            break;
          }
          case 'sem_cep': {
            fields.push('sem_cep = ?');
            values.push(parseBoolean(normalizedUpdateBody[key]));
            break;
          }
          case 'cep': {
            fields.push('cep = ?');
            values.push(normalizeCepForPersistence(normalizedUpdateBody[key], semCepBody));
            break;
          }
          default: {
            if (!ALLOWED_PROPERTY_TEXT_UPDATE_FIELDS.has(key)) {
              continue;
            }
            fields.push(`\`${key}\` = ?`);
            values.push(stringOrNull(normalizedUpdateBody[key]));
          }
        }
      }

      if (semNumeroBody === 1 && !bodyKeys.includes('numero')) {
        fields.push('numero = ?');
        values.push(null);
      }

      if (semCepBody === 1 && !bodyKeys.includes('cep')) {
        fields.push('cep = ?');
        values.push(null);
      }

      if (!supportsSale && bodyKeys.some((key) => key === 'promotion_price' || key === 'promotional_price')) {
        fields.push('promotion_price = ?');
        values.push(null);
        nextPromotionPrice = null;
      }

      if (!supportsRent && bodyKeys.includes('promotional_rent_price')) {
        fields.push('promotional_rent_price = ?');
        values.push(null);
        nextPromotionalRentPrice = null;
      }

      if (!supportsRent && bodyKeys.includes('promotional_rent_percentage')) {
        fields.push('promotional_rent_percentage = ?');
        values.push(null);
        nextPromotionalRentPercentage = null;
      }

      const nextBasePrice =
        supportsSale && nextSalePrice != null
          ? nextSalePrice
          : supportsRent
            ? nextRentPrice
            : nextSalePrice;
      const numericValidationError = [
        validatePropertyNumericRange(nextBasePrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
        validatePropertyNumericRange(nextSalePrice, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(nextRentPrice, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(nextPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(nextPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        bodyKeys.includes('bedrooms')
          ? validatePropertyNumericRange(
              normalizeNumericCountField(normalizedUpdateBody.bedrooms, {
                label: 'Quartos',
                required: false,
                hasField: bodyKeys.includes('bedrooms'),
              }),
              'Quartos',
              { max: MAX_PROPERTY_COUNT, allowNull: true }
            )
          : null,
        bodyKeys.includes('bathrooms')
          ? validatePropertyNumericRange(
              normalizeNumericCountField(normalizedUpdateBody.bathrooms, {
                label: 'Banheiros',
                required: false,
                hasField: bodyKeys.includes('bathrooms'),
              }),
              'Banheiros',
              { max: MAX_PROPERTY_COUNT, allowNull: true }
            )
          : null,
        bodyKeys.includes('garage_spots')
          ? validatePropertyNumericRange(
              normalizeNumericCountField(normalizedUpdateBody.garage_spots, {
                label: 'Garagens',
                required: false,
                hasField: bodyKeys.includes('garage_spots'),
              }),
              'Garagens',
              { max: MAX_PROPERTY_COUNT, allowNull: true }
            )
          : null,
        bodyKeys.includes('area_construida')
          ? validatePropertyNumericRange(
              parseDecimal(normalizedUpdateBody.area_construida),
              'Área construída',
              { max: MAX_PROPERTY_AREA, allowNull: true }
            )
          : null,
        bodyKeys.includes('area_terreno')
          ? validatePropertyNumericRange(
              parseDecimal(normalizedUpdateBody.area_terreno),
              'Área do terreno',
              { max: MAX_PROPERTY_AREA, allowNull: true }
            )
          : null,
        bodyKeys.includes('valor_condominio')
          ? validatePropertyNumericRange(
              parseDecimal(normalizedUpdateBody.valor_condominio),
              'Valor de condomínio',
              { max: MAX_PROPERTY_FEE, allowNull: true }
            )
          : null,
        bodyKeys.includes('valor_iptu')
          ? validatePropertyNumericRange(
              parseDecimal(normalizedUpdateBody.valor_iptu),
              'Valor de IPTU',
              { max: MAX_PROPERTY_FEE, allowNull: true }
            )
          : null,
      ].find(Boolean);

      if (numericValidationError) {
        return res.status(400).json({ error: numericValidationError });
      }

      if (
        nextPromotionPrice != null &&
        nextSalePrice != null &&
        Number(nextPromotionPrice) >= Number(nextSalePrice)
      ) {
        return res.status(400).json({
          error: 'Preço promocional de venda deve ser menor que o preço de venda.',
        });
      }

      if (
        nextPromotionalRentPrice != null &&
        nextRentPrice != null &&
        Number(nextPromotionalRentPrice) >= Number(nextRentPrice)
      ) {
        return res.status(400).json({
          error: 'Preço promocional de aluguel deve ser menor que o preço de aluguel.',
        });
      }

      if (
        nextPromotionPrice != null ||
        nextPromotionalRentPrice != null ||
        nextPromotionalRentPercentage != null ||
        nextPromotionPercentage != null
      ) {
        nextPromotionFlag = 1;
      }

      const previousPromotionNumericFlag = previousPromotionFlag ? 1 : 0;
      if (!bodyKeys.includes('is_promoted') && nextPromotionFlag !== previousPromotionNumericFlag) {
        fields.push('is_promoted = ?');
        values.push(nextPromotionFlag);
      }

      // Após rejeição admin, qualquer alteração reenvia para análise (ou POST dedicado resubmit-approval).
      const wasRejected = property.status === 'rejected';
      let resubmittedToPending = false;
      if (wasRejected) {
        for (let i = fields.length - 1; i >= 0; i--) {
          if (fields[i] === 'status = ?') {
            fields.splice(i, 1);
            values.splice(i, 1);
          }
        }
        nextStatus = null;
      }
      const hasImageListUpdate = Array.isArray((body as { images?: unknown }).images);
      if (wasRejected && (fields.length > 0 || hasImageListUpdate)) {
        // Mantém fora da vitrine até nova aprovação; approveProperty repõe visibility.
        fields.push('status = ?', 'rejection_reason = ?', 'visibility = ?');
        values.push('pending_approval', null, 'HIDDEN');
        resubmittedToPending = true;
      }

      if (fields.length === 0) {
        return res.status(400).json({ error: 'Nenhum dado fornecido para atualizacao.' });
      }

      values.push(propertyId);

      await runPropertyQuery(
        `UPDATE properties SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      if (Array.isArray(body.images) && property.status !== 'approved') {
        const images: string[] = body.images
          .filter((url: unknown) => typeof url === 'string' && url.trim().length > 0)
          .map((url: string) => url.trim());

        await runPropertyQuery('DELETE FROM property_images WHERE property_id = ?', [propertyId]);

        if (images.length > 0) {
          const imageValues = images.map((url) => [propertyId, url]);
          await runPropertyQuery(
            'INSERT INTO property_images (property_id, image_url) VALUES ?',
            [imageValues]
          );
        }
      }

      const effectiveStatus = resubmittedToPending
        ? 'pending_approval'
        : (nextStatus ?? property.status);
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

      if (!previousPromotionFlag && nextPromotionFlag === 1) {
        try {
          await notifyPromotionStarted({
            propertyId,
            propertyTitle: property.title,
            promotionPercentage: nextPromotionPercentage,
          });
        } catch (notifyError) {
          console.error('Erro ao notificar promoção de imóvel:', notifyError);
        }
      }

      if (nextStatus && NOTIFY_ON_STATUS.has(nextStatus)) {
        if (brokerId == null) {
          return res.status(403).json({ error: 'Apenas corretores podem fechar negocio.' });
        }
        try {
          const action = nextStatus === 'sold' ? 'vendido' : 'alugado';
          await notifyAdmins(
            `O imóvel '${property.title}' foi marcado como ${action}.`,
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
                return res.status(400).json({ error: 'Comissões ja realizadas invalidas.' });
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

          await upsertSaleRecord(propertyQueryExecutor, {
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

          await runPropertyQuery(
            'UPDATE properties SET sale_value = ?, commission_rate = ?, commission_value = ? WHERE id = ?',
            [dealAmount, commissionRate, commissionAmount, propertyId]
          );
        }
      }

      return res.status(200).json({ message: 'Imóvel atualizado com sucesso!' });
    } catch (error) {
      console.error('Erro ao atualizar imóvel:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  /**
   * Reenvia imóvel rejeitado para fila de análise sem outras alterações de payload.
   * Mesmo efeito de status / rejection_reason / visibility que o PATCH com dados ou imagens.
   */
  async resubmitApproval(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }
    if (req.userRole === 'client') {
      return res.status(403).json({ error: 'Apenas corretores podem reenviar anuncios.' });
    }
    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const propertyRows = await runPropertyQuery<PropertyRow[]>(
        'SELECT * FROM properties WHERE id = ?',
        [propertyId]
      );
      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }
      const property = propertyRows[0];
      const isOwner =
        (property.broker_id != null && property.broker_id === userId) ||
        (property.owner_id != null && property.owner_id === userId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Acesso nao autorizado a este imovel.' });
      }
      if (property.status === 'pending_approval') {
        return res.status(409).json({ error: 'Imovel ja esta em analise.' });
      }
      if (property.status !== 'rejected') {
        return res.status(409).json({
          error: 'Somente imoveis rejeitados podem ser reenviados desta forma.',
        });
      }

      await runPropertyQuery(
        `UPDATE properties SET
          status = 'pending_approval',
          rejection_reason = NULL,
          visibility = 'HIDDEN',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [propertyId]
      );

      try {
        await notifyAdmins(`Imovel #${propertyId} reenviado para analise apos rejeicao.`, 'property', propertyId);
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre reenvio de imovel:', notifyError);
      }

      return res.status(200).json({
        message: 'Imovel reenviado para analise.',
        status: 'pending_approval',
      });
    } catch (error) {
      console.error('Erro ao reenviar imovel:', error);
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
      return res.status(401).json({ error: 'Corretor não autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
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
      const propertyRows = await runPropertyQuery<PropertyRow[]>(
        'SELECT * FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      const property = propertyRows[0];
      if (property.broker_id !== brokerId) {
        return res.status(403).json({ error: 'Acesso não autorizado a este imóvel.' });
      }

      if (property.status === 'pending_approval' || property.status === 'rejected') {
        return res.status(403).json({ error: 'Imóvel ainda não pode ser fechado.' });
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
            return res.status(400).json({ error: "Comissões já realizadas inválidas." });
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

      const db = await getPropertyDbConnection();
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
        message: 'Negócio fechado com sucesso.',
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
      return res.status(400).json({ error: 'Identificador de imóvel invalido.' });
    }

    try {
      const propertyRows = await runPropertyQuery<PropertyRow[]>(
        'SELECT id, broker_id, status FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imóvel nao encontrado.' });
      }

      const property = propertyRows[0];
      if (property.broker_id !== brokerId) {
        return res.status(403).json({ error: 'Acesso nao autorizado a este imóvel.' });
      }

      if (property.status !== 'sold' && property.status !== 'rented') {
        return res.status(400).json({ error: 'Este imóvel nao possui negocio fechado.' });
      }

      const db = await getPropertyDbConnection();
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
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
    }

    try {
      const propertyRows = await runPropertyQuery<RowDataPacket[]>(
        'SELECT broker_id, owner_id, video_url FROM properties WHERE id = ?',
        [propertyId]
      );

      if (!propertyRows || propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      const property = propertyRows[0];
      const isOwner =
        (property.broker_id != null && property.broker_id === userId) ||
        (property.owner_id != null && property.owner_id === userId);
      if (!isOwner) {
        return res.status(403).json({ error: 'Voce nao tem permissao para deletar este imovel.' });
      }

      // LGPD: não apagar ficha. Encerrar anúncio = marcar como vendido, ocultar da vitrine, manter mídia no storage.
      await runPropertyQuery(
        `UPDATE properties
         SET
           status = 'sold',
           visibility = 'HIDDEN',
           lifecycle_status = 'SOLD',
           updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [propertyId]
      );
      try {
        await runPropertyQuery('DELETE FROM featured_properties WHERE property_id = ?', [propertyId]);
      } catch {
        /* tabela/caso legacy */
      }

      return res.status(200).json({
        message: 'Imóvel marcado como vendido e removido da vitrine pública.',
        status: 'sold',
      });
    } catch (error) {
      console.error('Erro ao deletar imóvel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getAvailableCities(req: Request, res: Response) {
    try {
      const rows = await runPropertyQuery<RowDataPacket[]>(
        `
          SELECT DISTINCT city
          FROM properties
          WHERE city IS NOT NULL
            AND city <> ''
            AND status = 'approved'
            AND COALESCE(visibility, 'PUBLIC') = 'PUBLIC'
          ORDER BY city ASC
        `
        ,
        []
      );
      return res.status(200).json(rows.map((row) => row.city));
    } catch (error) {
      console.error('Erro ao buscar cidades disponíveis:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getAvailableCitiesWithCount(req: Request, res: Response) {
    try {
      const placeholders = NEGOTIATION_PUBLIC_BLOCKING_STATUSES.map(() => '?').join(', ');
      const rows = await runPropertyQuery<RowDataPacket[]>(
        `
          SELECT
            p.city,
            COUNT(*) AS total
          FROM properties p
          WHERE p.city IS NOT NULL
            AND p.city <> ''
            AND p.status = 'approved'
            AND COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'
            AND NOT EXISTS (
              SELECT 1
              FROM negotiations nx
              WHERE nx.property_id = p.id
                AND UPPER(TRIM(nx.status)) IN (${placeholders})
            )
          GROUP BY p.city
          ORDER BY p.city ASC
        `,
        [...NEGOTIATION_PUBLIC_BLOCKING_STATUSES]
      );
      return res.status(200).json(
        rows.map((row) => ({
          city: String(row.city ?? '').trim(),
          total: Number(row.total ?? 0),
        }))
      );
    } catch (error) {
      console.error('Erro ao buscar cidades disponíveis com contagem:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getAvailableBairrosWithCount(req: Request, res: Response) {
    const city = String(req.query.city ?? '').trim();
    try {
      const placeholders = NEGOTIATION_PUBLIC_BLOCKING_STATUSES.map(() => '?').join(', ');
      const whereParams: Array<string> = [];
      let cityClause = '';
      if (city.length > 0) {
        cityClause = ' AND p.city LIKE ?';
        whereParams.push(`%${city}%`);
      }
      whereParams.push(...NEGOTIATION_PUBLIC_BLOCKING_STATUSES);

      const rows = await runPropertyQuery<RowDataPacket[]>(
        `
          SELECT
            p.bairro,
            p.city,
            COUNT(*) AS total
          FROM properties p
          WHERE p.bairro IS NOT NULL
            AND p.bairro <> ''
            AND p.status = 'approved'
            AND COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'
            ${cityClause}
            AND NOT EXISTS (
              SELECT 1
              FROM negotiations nx
              WHERE nx.property_id = p.id
                AND UPPER(TRIM(nx.status)) IN (${placeholders})
            )
          GROUP BY p.bairro, p.city
          ORDER BY p.bairro ASC
        `,
        whereParams
      );

      return res.status(200).json(
        rows.map((row) => ({
          bairro: String(row.bairro ?? '').trim(),
          city: String(row.city ?? '').trim(),
          total: Number(row.total ?? 0),
        }))
      );
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
      const rows = await runPropertyQuery<PropertyAggregateRow[]>(
        `
          SELECT
            p.*,
            COALESCE(p.promo_percentage, p.promotion_percentage) AS promo_percentage_resolved,
            COALESCE(p.promo_start_date, DATE(p.promotion_start)) AS promo_start_date_resolved,
            COALESCE(p.promo_end_date, DATE(p.promotion_end)) AS promo_end_date_resolved,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
            ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
            ANY_VALUE(COALESCE(u.email, u_owner.email)) AS broker_email,
            ANY_VALUE(an.id) AS active_negotiation_id,
            ANY_VALUE(an.status) AS active_negotiation_status,
            ANY_VALUE(an.final_value) AS active_negotiation_value,
            ANY_VALUE(nbu.name) AS active_negotiation_client_name,
            ANY_VALUE(per.id) AS pending_edit_request_id,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN (
            SELECT
              ranked.property_id,
              ranked.id,
              ranked.status,
              ranked.final_value,
              ranked.buyer_client_id
            FROM (
              SELECT
                n.property_id,
                n.id,
                n.status,
                n.final_value,
                n.buyer_client_id,
                ROW_NUMBER() OVER (
                  PARTITION BY n.property_id
                  ORDER BY n.version DESC, n.id DESC
                ) AS rn
              FROM negotiations n
              WHERE n.status NOT IN (?, ?, ?, ?, ?)
            ) ranked
            WHERE ranked.rn = 1
          ) an ON an.property_id = p.id
          LEFT JOIN users nbu ON nbu.id = an.buyer_client_id
          LEFT JOIN property_edit_requests per
            ON per.property_id = p.id
           AND per.status = 'PENDING'
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE p.owner_id = ? OR p.broker_id = ?
          GROUP BY p.id
          ORDER BY p.created_at DESC
        `,
        [...NEGOTIATION_TERMINAL_STATUSES, userId, userId]
      );

      return res.json(rows.map(row => mapProperty(row, true)));
    } catch (error) {
      console.error('Erro ao listar imóveis do usuário:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
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
      bathrooms,
      has_wifi,
      tem_piscina,
      tem_energia_solar,
      tem_automacao,
      tem_ar_condicionado,
      eh_mobiliada,
      sortBy: sortByQuery,
      order,
      status,
    } = req.query;
    const minPriceParam = minPrice ?? req.query.min_price;
    const maxPriceParam = maxPrice ?? req.query.max_price;
    const sortByResolved = sortByQuery ?? req.query.sort;
    const searchTermRaw = req.query.searchTerm ?? req.query.search;
    const searchTerm =
      typeof searchTermRaw === 'string' && searchTermRaw.trim().length > 0
        ? searchTermRaw
        : undefined;

    const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const numericPage = Math.max(Number(page) || 1, 1);
    const offset = (numericPage - 1) * numericLimit;

    const whereClauses: string[] = [];
    const params: any[] = [];

    const effectiveStatus: PropertyStatus = 'approved';
    whereClauses.push('p.status = ?');
    params.push(effectiveStatus);
    whereClauses.push(`COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'`);

    if (type) {
      const normalizedType = normalizePropertyType(type);
      if (!normalizedType) {
        return res.status(400).json({ error: 'Tipo de imóvel inválido.' });
      }
      whereClauses.push('p.type = ?');
      params.push(normalizedType);
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

    if (minPriceParam) {
      const value = Number(minPriceParam);
      if (!Number.isNaN(value)) {
        whereClauses.push(`${priceColumn} >= ?`);
        params.push(value);
      }
    }

    if (maxPriceParam) {
      const value = Number(maxPriceParam);
      if (!Number.isNaN(value)) {
        whereClauses.push(`${priceColumn} <= ?`);
        params.push(value);
      }
    }

    const minAreaConstruida = req.query.min_area_construida ?? req.query.minAreaConstruida;
    const maxAreaConstruida = req.query.max_area_construida ?? req.query.maxAreaConstruida;
    if (minAreaConstruida != null && String(minAreaConstruida).trim() !== '') {
      const value = Number(minAreaConstruida);
      if (!Number.isNaN(value) && value >= 0) {
        whereClauses.push('p.area_construida >= ?');
        params.push(value);
      }
    }
    if (maxAreaConstruida != null && String(maxAreaConstruida).trim() !== '') {
      const value = Number(maxAreaConstruida);
      if (!Number.isNaN(value) && value >= 0) {
        whereClauses.push('p.area_construida <= ?');
        params.push(value);
      }
    }

    if (bedrooms) {
      const value = Number(bedrooms);
      if (!Number.isNaN(value) && value > 0) {
        const normalized = Math.trunc(value);
        if (normalized >= 4) {
          whereClauses.push('p.bedrooms >= ?');
          params.push(4);
        } else {
          whereClauses.push('p.bedrooms = ?');
          params.push(normalized);
        }
      }
    }

    if (bathrooms) {
      const value = Number(bathrooms);
      if (!Number.isNaN(value) && value > 0) {
        const normalized = Math.trunc(value);
        if (normalized >= 4) {
          whereClauses.push('p.bathrooms >= ?');
          params.push(4);
        } else {
          whereClauses.push('p.bathrooms = ?');
          params.push(normalized);
        }
      }
    }

    if (has_wifi !== undefined) {
      whereClauses.push('p.has_wifi = ?');
      params.push(parseBoolean(has_wifi));
    }

    if (tem_piscina !== undefined) {
      whereClauses.push('p.tem_piscina = ?');
      params.push(parseBoolean(tem_piscina));
    }

    if (tem_energia_solar !== undefined) {
      whereClauses.push('p.tem_energia_solar = ?');
      params.push(parseBoolean(tem_energia_solar));
    }

    if (tem_automacao !== undefined) {
      whereClauses.push('p.tem_automacao = ?');
      params.push(parseBoolean(tem_automacao));
    }

    if (tem_ar_condicionado !== undefined) {
      whereClauses.push('p.tem_ar_condicionado = ?');
      params.push(parseBoolean(tem_ar_condicionado));
    }

    if (eh_mobiliada !== undefined) {
      whereClauses.push('p.eh_mobiliada = ?');
      params.push(parseBoolean(eh_mobiliada));
    }

    if (searchTerm) {
      const term = `%${searchTerm}%`;
      whereClauses.push('(p.title LIKE ? OR p.city LIKE ? OR p.address LIKE ? OR p.bairro LIKE ? )');
      params.push(term, term, term, term);
    }

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const idRaw = req.query.id;
    const idTrimmed = typeof idRaw === 'string' ? idRaw.trim() : '';
    const codeOrIdRaw = req.query.code ?? req.query.propertyCode;
    const codeOrId =
      typeof codeOrIdRaw === 'string' && codeOrIdRaw.trim().length > 0 ? codeOrIdRaw.trim() : '';

    if (idTrimmed && uuidRe.test(idTrimmed)) {
      whereClauses.push('p.id = ?');
      params.push(idTrimmed);
    } else if (codeOrId) {
      if (uuidRe.test(codeOrId)) {
        whereClauses.push('p.id = ?');
        params.push(codeOrId);
      } else {
        whereClauses.push('TRIM(p.code) = ?');
        params.push(codeOrId);
      }
    }

    const negotiationPlaceholders = NEGOTIATION_PUBLIC_BLOCKING_STATUSES.map(() => '?').join(', ');
    whereClauses.push(`NOT EXISTS (
      SELECT 1 FROM negotiations nx
      WHERE nx.property_id = p.id
        AND UPPER(TRIM(nx.status)) IN (${negotiationPlaceholders})
    )`);
    params.push(...NEGOTIATION_PUBLIC_BLOCKING_STATUSES);

    const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const allowedSortColumns: Record<string, string> = {
      price: priceColumn,
      created_at: 'p.created_at',
      area_construida: 'p.area_construida',
    };

    const sortColumn = allowedSortColumns[String(sortByResolved ?? '').toLowerCase()] ?? 'p.created_at';
    const sortDirection = String(order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
      const rows = await runPropertyQuery<PropertyAggregateRow[]>(
        `
          SELECT
            p.*,
            COALESCE(p.promo_percentage, p.promotion_percentage) AS promo_percentage_resolved,
            COALESCE(p.promo_start_date, DATE(p.promotion_start)) AS promo_start_date_resolved,
            COALESCE(p.promo_end_date, DATE(p.promotion_end)) AS promo_end_date_resolved,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
            ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
            ANY_VALUE(COALESCE(u.email, u_owner.email)) AS broker_email,
            ANY_VALUE(an.id) AS active_negotiation_id,
            ANY_VALUE(an.status) AS active_negotiation_status,
            ANY_VALUE(an.final_value) AS active_negotiation_value,
            ANY_VALUE(nbu.name) AS active_negotiation_client_name,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN (
            SELECT
              ranked.property_id,
              ranked.id,
              ranked.status,
              ranked.final_value,
              ranked.buyer_client_id
            FROM (
              SELECT
                n.property_id,
                n.id,
                n.status,
                n.final_value,
                n.buyer_client_id,
                ROW_NUMBER() OVER (
                  PARTITION BY n.property_id
                  ORDER BY n.version DESC, n.id DESC
                ) AS rn
              FROM negotiations n
              WHERE n.status NOT IN (?, ?, ?, ?, ?)
            ) ranked
            WHERE ranked.rn = 1
          ) an ON an.property_id = p.id
          LEFT JOIN users nbu ON nbu.id = an.buyer_client_id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          ${where}
          GROUP BY p.id
          ORDER BY ${sortColumn} ${sortDirection}
          LIMIT ? OFFSET ?
        `,
        [...NEGOTIATION_TERMINAL_STATUSES, ...params, numericLimit, offset]
      );

      const totalRows = await runPropertyQuery<RowDataPacket[]>(
        `SELECT COUNT(DISTINCT p.id) AS total FROM properties p ${where}`,
        params
      );

      const total = totalRows[0]?.total ?? 0;

      return res.json({
        properties: rows.map(row => mapProperty(row, false)),
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
  async listFeaturedProperties(req: Request, res: Response) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 20);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const offset = (page - 1) * limit;
    const scopeParam = String(req.query.scope ?? "sale").toLowerCase();
    const scope: "sale" | "rent" = scopeParam === "rent" ? "rent" : "sale";

    try {
      const rows = await runPropertyQuery<PropertyAggregateRow[]>(
        `
          SELECT
            p.*,
            COALESCE(p.promo_percentage, p.promotion_percentage) AS promo_percentage_resolved,
            COALESCE(p.promo_start_date, DATE(p.promotion_start)) AS promo_start_date_resolved,
            COALESCE(p.promo_end_date, DATE(p.promotion_end)) AS promo_end_date_resolved,
            ANY_VALUE(a.id) AS agency_id,
            ANY_VALUE(a.name) AS agency_name,
            ANY_VALUE(a.logo_url) AS agency_logo_url,
            ANY_VALUE(a.address) AS agency_address,
            ANY_VALUE(a.city) AS agency_city,
            ANY_VALUE(a.state) AS agency_state,
            ANY_VALUE(a.phone) AS agency_phone,
            ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
            ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
            ANY_VALUE(COALESCE(u.email, u_owner.email)) AS broker_email,
            ANY_VALUE(an.id) AS active_negotiation_id,
            ANY_VALUE(an.status) AS active_negotiation_status,
            ANY_VALUE(an.final_value) AS active_negotiation_value,
            ANY_VALUE(nbu.name) AS active_negotiation_client_name,
            GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
          FROM featured_properties fp
          JOIN properties p ON p.id = fp.property_id
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN (
            SELECT
              ranked.property_id,
              ranked.id,
              ranked.status,
              ranked.final_value,
              ranked.buyer_client_id
            FROM (
              SELECT
                n.property_id,
                n.id,
                n.status,
                n.final_value,
                n.buyer_client_id,
                ROW_NUMBER() OVER (
                  PARTITION BY n.property_id
                  ORDER BY n.version DESC, n.id DESC
                ) AS rn
              FROM negotiations n
              WHERE n.status NOT IN (?, ?, ?, ?, ?)
            ) ranked
            WHERE ranked.rn = 1
          ) an ON an.property_id = p.id
          LEFT JOIN users nbu ON nbu.id = an.buyer_client_id
          LEFT JOIN property_images pi ON pi.property_id = p.id
          WHERE p.status = 'approved'
            AND COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'
            AND fp.scope = ?
            AND (
              (fp.scope = 'sale' AND p.purpose IN ('Venda', 'Venda e Aluguel'))
              OR (fp.scope = 'rent' AND p.purpose IN ('Aluguel', 'Venda e Aluguel'))
            )
            AND NOT EXISTS (
              SELECT 1 FROM negotiations nx
              WHERE nx.property_id = p.id
                AND UPPER(TRIM(nx.status)) IN (${NEGOTIATION_PUBLIC_BLOCKING_STATUSES.map(() => '?').join(', ')})
            )
          GROUP BY p.id, fp.scope, fp.position
          ORDER BY fp.position ASC
          LIMIT ? OFFSET ?
        `,
        [...NEGOTIATION_TERMINAL_STATUSES, scope, ...NEGOTIATION_PUBLIC_BLOCKING_STATUSES, limit, offset]
      );

      const countRows = await runPropertyQuery<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM featured_properties fp
          JOIN properties p ON p.id = fp.property_id
          WHERE p.status = 'approved'
            AND COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'
            AND fp.scope = ?
            AND (
              (fp.scope = 'sale' AND p.purpose IN ('Venda', 'Venda e Aluguel'))
              OR (fp.scope = 'rent' AND p.purpose IN ('Aluguel', 'Venda e Aluguel'))
            )
            AND NOT EXISTS (
              SELECT 1 FROM negotiations nx
              WHERE nx.property_id = p.id
                AND UPPER(TRIM(nx.status)) IN (${NEGOTIATION_PUBLIC_BLOCKING_STATUSES.map(() => '?').join(', ')})
            )
        `
        ,
        [scope, ...NEGOTIATION_PUBLIC_BLOCKING_STATUSES]
      );

      const total = countRows[0]?.total ?? 0;

      return res.json({
        properties: rows.map(row => mapProperty(row, false)),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
    } catch (error) {
      console.error('Erro ao listar destaques:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

}

export const propertyController = new PropertyController();


