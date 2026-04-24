import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { adminDb } from '../services/adminPersistenceService';
import {
  hasValidCreci,
  normalizeCreci,
  normalizePropertyType,
  sanitizeAddressInput,
  sanitizePartialAddressInput,
  signAdminReauthToken,
  signAdminToken,
} from '../services/adminControllerSupport';
import cloudinary, { deleteCloudinaryAsset, uploadToCloudinary } from '../config/cloudinary';
import { createUserNotification, notifyAdmins } from '../services/notificationService';
import { sendPushNotifications, type PushNotificationResult } from '../services/pushNotificationService';
import {
  notifyPriceDropIfNeeded,
  notifyPromotionStarted,
} from '../services/priceDropNotificationService';
import { notifyUsers, resolveUserNotificationRole, splitRecipientsByRole } from '../services/userNotificationService';
import {
  approveBrokerAccount,
  deleteUserAccount,
  isActiveBrokerStatus,
  loadUserLifecycleSnapshot,
  rejectBrokerAccount,
} from '../services/adminAccountLifecycleService';
import {
  buildEditablePropertyState,
  buildPropertyEditDbPatch,
  preparePropertyEditPatch,
  type EditablePropertyDiff,
  type EditablePropertyPatch,
} from '../services/propertyEditRequestService';
import type AuthRequest from '../middlewares/auth';
import {
  deleteNegotiationDocumentObject,
  readNegotiationDocumentObject,
} from '../services/negotiationDocumentStorageService';
import { saveNegotiationSignedProposalDocument } from '../services/negotiationPersistenceService';
import { allocateNextPropertyCode } from '../utils/propertyCode';
import { areaInputToSquareMeters, normalizeAreaUnidade } from '../utils/propertyAreaUnits';

type PropertyStatus = 'pending_approval' | 'approved' | 'rejected' | 'rented' | 'sold';

type Nullable<T> = T | null;

const STATUS_MAP: Record<string, PropertyStatus> = {
  pendingapproval: 'pending_approval',
  pendente: 'pending_approval',
  pending: 'pending_approval',
  aprovado: 'approved',
  aprovada: 'approved',
  approved: 'approved',
  rejeitado: 'rejected',
  rejeitada: 'rejected',
  rejected: 'rejected',
  alugado: 'rented',
  alugada: 'rented',
  rented: 'rented',
  vendido: 'sold',
  vendida: 'sold',
  sold: 'sold',
};

async function updateBrokerRecordWithLegacyUpdatedAtFallback(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  brokerId: number,
  status: string
): Promise<void> {
  try {
    await db.query('UPDATE brokers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
      status,
      brokerId,
    ]);
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
    const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
    if (code !== 'ER_BAD_FIELD_ERROR' || !message.includes("unknown column 'updated_at'")) {
      throw error;
    }
    await db.query('UPDATE brokers SET status = ? WHERE id = ?', [status, brokerId]);
  }
}

async function promoteBrokerRecordWithLegacyUpdatedAtFallback(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  brokerId: number,
  creci: string
): Promise<void> {
  try {
    await db.query(
      `UPDATE brokers SET creci = ?, status = 'approved', agency_id = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [creci, brokerId],
    );
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
    const message = String((error as { message?: unknown })?.message ?? '').toLowerCase();
    if (code !== 'ER_BAD_FIELD_ERROR' || !message.includes("unknown column 'updated_at'")) {
      throw error;
    }
    await db.query(
      `UPDATE brokers SET creci = ?, status = 'approved', agency_id = NULL
       WHERE id = ?`,
      [creci, brokerId],
    );
  }
}

const ALLOWED_STATUS = new Set<PropertyStatus>([
  'pending_approval',
  'approved',
  'rejected',
  'rented',
  'sold',
]);

const PURPOSE_MAP: Record<string, string> = {
  venda: 'Venda',
  comprar: 'Venda',
  aluguel: 'Aluguel',
  alugar: 'Aluguel',
  vendaealuguel: 'Venda e Aluguel',
  vendaaluguel: 'Venda e Aluguel',
};

const ALLOWED_PURPOSES = new Set(['Venda', 'Aluguel', 'Venda e Aluguel']);
const MAX_IMAGES_PER_PROPERTY = 20;
const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_GENERIC_PROPERTY_TEXT_LENGTH = 120;
const MAX_PROPERTY_COUNT = 99;
const MAX_PROPERTY_AREA = 9999999.99;
const MAX_PROPERTY_PRICE = 9999999999.99;
const MAX_PROPERTY_FEE = 99999999.99;
const IMAGE_UPLOAD_CONCURRENCY = 4;
const DIRECT_UPLOAD_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
const DIRECT_UPLOAD_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
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
  'numero',
  'complemento',
  'owner_name',
  'cep',
  'visibility',
  'lifecycle_status',
  'video_url',
]);

async function cleanupPropertyMediaAssets(
  urls: Array<string | null | undefined>,
  context: string
): Promise<void> {
  for (const rawUrl of urls) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) {
      continue;
    }

    try {
      await deleteCloudinaryAsset({ url, invalidate: true });
    } catch (error) {
      console.error('Erro ao excluir asset do Cloudinary:', {
        context,
        url,
        error,
      });
    }
  }
}
const CLOUDINARY_IMAGE_ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'svg'];
const CLOUDINARY_VIDEO_ALLOWED_FORMATS = ['mp4', 'mov', 'avi', 'webm', '3gp'];

function normalizeStatus(value: unknown): Nullable<PropertyStatus> {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
  const status = STATUS_MAP[normalized];
  if (!status || !ALLOWED_STATUS.has(status)) {
    return null;
  }
  return status;
}

function normalizePurpose(value: unknown): Nullable<string> {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
  const mapped = PURPOSE_MAP[normalized];
  if (!mapped || !ALLOWED_PURPOSES.has(mapped)) {
    return null;
  }
  return mapped;
}

function parseDecimal(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function parseInteger(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}


function parseBoolean(value: unknown): 0 | 1 {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  } 
  
  if (typeof value === 'number') {
    return value === 0 ? 0 : 1;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'sim', 'on'].includes(normalized) ? 1 : 0;
  }
  return 0;
}

function parsePromotionPercentage(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error('Percentual de promocao invalido. Use valor entre 0 e 100.');
  }
  return Number(parsed.toFixed(2));
}

function parsePromotionDateTime(value: unknown): Nullable<string> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Data de promocao invalida.');
  }
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeTipoLote(value: unknown): 'meio' | 'inteiro' | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'meio') {
    return 'meio';
  }
  if (normalized === 'inteiro') {
    return 'inteiro';
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const textual = String(value).trim();
  return textual.length > 0 ? textual : null;
}

function hasValidPropertyDescription(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_PROPERTY_DESCRIPTION_LENGTH
  );
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
    return `${label} inválido.`;
  }
  if (value > options.max) {
    return `${label} deve ser no máximo ${options.max}.`;
  }
  return null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeDigits(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/\D/g, '');
}

function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return EMAIL_REGEX.test(value.trim());
}

function normalizePhone(value: unknown): string {
  return normalizeDigits(value).slice(0, 13);
}

function hasValidPhone(value: unknown): boolean {
  const length = normalizePhone(value).length;
  return length >= 10 && length <= 13;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [trimmed];
}

function parseImageUrlsInput(body: Record<string, unknown>): string[] {
  const fromArrayField = parseStringArray(body.image_urls);
  const fromBracketField = parseStringArray(body['image_urls[]']);
  return Array.from(new Set([...fromArrayField, ...fromBracketField]));
}

function isAllowedCloudinaryMediaUrl(urlValue: string, expectedFolder: string): boolean {
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      return false;
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) return false;
    if (!parsed.pathname.startsWith(`/${cloudName}/`)) {
      return false;
    }
    return parsed.pathname.includes(`/${expectedFolder}/`);
  } catch {
    return false;
  }
}

async function uploadImagesWithConcurrency(
  files: Express.Multer.File[],
  folder: string,
  concurrency = IMAGE_UPLOAD_CONCURRENCY
): Promise<string[]> {
  if (files.length === 0) {
    return [];
  }

  const results: string[] = new Array(files.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, files.length) },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= files.length) {
          break;
        }
        const uploaded = await uploadToCloudinary(files[currentIndex], folder);
        results[currentIndex] = uploaded.url;
      }
    }
  );

  await Promise.all(workers);
  return results;
}

interface PropertyDetailRow extends RowDataPacket {
  id: number;
  broker_id?: number | null;
  owner_id?: number | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  code?: string | null;
  title: string;
  description?: string | null;
  type?: string | null;
  purpose?: string | null;
  status: string;
  is_promoted?: number | boolean | null;
  promotion_percentage?: number | string | null;
  promotional_rent_percentage?: number | string | null;
  promotion_start?: Date | string | null;
  promotion_end?: Date | string | null;
  price?: number | string | null;
  price_sale?: number | string | null;
  price_rent?: number | string | null;
  promotion_price?: number | string | null;
  promotional_rent_price?: number | string | null;
  address?: string | null;
  quadra?: string | null;
  lote?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  tipo_lote?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  area_construida?: number | string | null;
  area_terreno?: number | string | null;
  garage_spots?: number | string | null;
  valor_condominio?: number | string | null;
  valor_iptu?: number | string | null;
  video_url?: string | null;
  has_wifi?: number | boolean | null;
  tem_piscina?: number | boolean | null;
  tem_energia_solar?: number | boolean | null;
  tem_automacao?: number | boolean | null;
  tem_ar_condicionado?: number | boolean | null;
  eh_mobiliada?: number | boolean | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  images?: string | string[] | null;
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_status?: string | null;
  broker_creci?: string | null;
}

interface ArchivePropertyRow extends RowDataPacket {
  id: number;
  code: string | null;
  title: string;
  status: 'sold' | 'rented';
  broker_name: string | null;
  transaction_date: Date | string | null;
}

interface PropertyEditRequestListRow extends RowDataPacket {
  id: number;
  property_id: number;
  requester_user_id: number;
  requester_role: string;
  status: string;
  before_json: unknown;
  after_json: unknown;
  diff_json: unknown;
  field_reviews_json: unknown;
  review_reason: string | null;
  reviewed_by: number | null;
  reviewed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  property_title: string | null;
  property_code: string | null;
  requester_name: string | null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function mapAdminProperty(row: PropertyDetailRow) {
  const images = Array.isArray(row.images)
    ? row.images
    : row.images
    ? String(row.images)
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((pair) => {
          const [id, url] = pair.split('|');
          const numId = Number(id);
          return { id: Number.isFinite(numId) ? numId : null, url };
        })
        .filter((item) => item.id !== null && item.url)
    : [];

  return {
    id: row.id,
    broker_id: row.broker_id ?? null,
    owner_id: row.owner_id ?? null,
    owner_name: row.owner_name ?? null,
    owner_phone: row.owner_phone ?? null,
    code: row.code ?? null,
    title: row.title,
    description: row.description ?? null,
    type: row.type ?? '',
    purpose: row.purpose ?? null,
    status: row.status as string,
    is_promoted: parseBoolean(row.is_promoted),
    promotion_percentage: toNullableNumber(row.promotion_percentage),
    promotional_rent_percentage: toNullableNumber(row.promotional_rent_percentage),
    promotion_start: row.promotion_start ? String(row.promotion_start) : null,
    promotion_end: row.promotion_end ? String(row.promotion_end) : null,
    price: toNullableNumber(row.price) ?? 0,
    price_sale: toNullableNumber(row.price_sale),
    price_rent: toNullableNumber(row.price_rent),
    promotion_price: toNullableNumber(row.promotion_price),
    promotional_rent_price: toNullableNumber(row.promotional_rent_price),
    promotionalPrice: toNullableNumber(row.promotion_price),
    promotionalRentPrice: toNullableNumber(row.promotional_rent_price),
    promotionalRentPercentage: toNullableNumber(row.promotional_rent_percentage),
    address: row.address ?? null,
    cep: row.cep ?? null,
    quadra: row.quadra ?? null,
    lote: row.lote ?? null,
    numero: row.numero ?? null,
    bairro: row.bairro ?? null,
    complemento: row.complemento ?? null,
    tipo_lote: row.tipo_lote ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    bedrooms: toNullableNumber(row.bedrooms),
    bathrooms: toNullableNumber(row.bathrooms),
    area_construida: toNullableNumber(row.area_construida),
    area_terreno: toNullableNumber(row.area_terreno),
    garage_spots: toNullableNumber(row.garage_spots),
    valor_condominio: toNullableNumber(row.valor_condominio),
    valor_iptu: toNullableNumber(row.valor_iptu),
    video_url: row.video_url ?? null,
    has_wifi: parseBoolean(row.has_wifi),
    tem_piscina: parseBoolean(row.tem_piscina),
    tem_energia_solar: parseBoolean(row.tem_energia_solar),
    tem_automacao: parseBoolean(row.tem_automacao),
    tem_ar_condicionado: parseBoolean(row.tem_ar_condicionado),
    eh_mobiliada: parseBoolean(row.eh_mobiliada),
    images,
    broker_name: row.broker_name ?? null,
    broker_phone: row.broker_phone ?? null,
    broker_status: row.broker_status ?? null,
    broker_creci: row.broker_creci ?? null,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function mapPropertyEditRequest(row: PropertyEditRequestListRow) {
  return {
    id: Number(row.id),
    propertyId: Number(row.property_id),
    propertyTitle: row.property_title ?? null,
    propertyCode: row.property_code ?? null,
    requesterUserId: Number(row.requester_user_id),
    requesterRole: String(row.requester_role ?? '').toLowerCase(),
    requesterName: row.requester_name ?? null,
    status: String(row.status ?? '').toUpperCase(),
    before: parseJsonObjectSafe(row.before_json),
    after: parseJsonObjectSafe(row.after_json),
    diff: parseJsonObjectSafe(row.diff_json),
    fieldReviews: parseJsonObjectSafe(row.field_reviews_json),
    reviewReason: row.review_reason ?? null,
    reviewedBy: row.reviewed_by != null ? Number(row.reviewed_by) : null,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

type PropertyEditFieldReviewDecision = 'APPROVED' | 'REJECTED';
type PropertyEditFieldReview = {
  decision: PropertyEditFieldReviewDecision;
  reason?: string | null;
};

const PROPERTY_EDIT_FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  type: 'Tipo',
  purpose: 'Finalidade',
  code: 'Código',
  ownerName: 'Nome do proprietário',
  ownerPhone: 'Telefone do proprietário',
  address: 'Endereço',
  quadra: 'Quadra',
  lote: 'Lote',
  numero: 'Número',
  bairro: 'Bairro',
  complemento: 'Complemento',
  tipoLote: 'Tipo de lote',
  city: 'Cidade',
  state: 'Estado',
  cep: 'CEP',
  bedrooms: 'Quartos',
  bathrooms: 'Banheiros',
  areaConstruida: 'Área construída',
  areaTerreno: 'Área do terreno',
  garageSpots: 'Garagens',
  hasWifi: 'Wi-Fi',
  temPiscina: 'Piscina',
  temEnergiaSolar: 'Energia solar',
  temAutomacao: 'Automação',
  temArCondicionado: 'Ar-condicionado',
  ehMobiliada: 'Mobiliada',
  valorCondominio: 'Condomínio',
  priceSale: 'Preço de venda',
  priceRent: 'Preço de aluguel',
  isPromoted: 'Promoção ativa',
  promotionPercentage: '% Promoção',
  promotionPrice: 'Preço promocional venda',
  promotionalRentPrice: 'Preço promocional aluguel',
  promotionalRentPercentage: '% Promoção aluguel',
  promotionStart: 'Início da promoção',
  promotionEnd: 'Fim da promoção',
};

function normalizeFieldReviews(
  rawValue: unknown,
  diff: EditablePropertyDiff
): Record<string, PropertyEditFieldReview> {
  const raw = parseJsonObjectSafe(rawValue);
  const reviews: Record<string, PropertyEditFieldReview> = {};
  const diffKeys = Object.keys(diff);

  for (const key of diffKeys) {
    const candidate = parseJsonObjectSafe(raw[key]);
    const decision = String(candidate.decision ?? '').trim().toUpperCase();
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new Error(`Campo "${PROPERTY_EDIT_FIELD_LABELS[key] ?? key}" precisa ser aprovado ou rejeitado.`);
    }

    const reason = String(candidate.reason ?? '').trim();
    if (decision === 'REJECTED' && reason.length === 0) {
      throw new Error(`Informe o motivo da rejeição para "${PROPERTY_EDIT_FIELD_LABELS[key] ?? key}".`);
    }

    reviews[key] = {
      decision: decision as PropertyEditFieldReviewDecision,
      reason: reason.length > 0 ? reason : null,
    };
  }

  for (const key of Object.keys(raw)) {
    if (!diffKeys.includes(key)) {
      throw new Error(`Campo "${key}" não pertence a esta solicitação de edição.`);
    }
  }

  return reviews;
}

function resolveReviewedRequestStatus(
  fieldReviews: Record<string, PropertyEditFieldReview>
): 'APPROVED' | 'REJECTED' | 'PARTIALLY_APPROVED' {
  const decisions = Object.values(fieldReviews).map((item) => item.decision);
  const approvedCount = decisions.filter((item) => item === 'APPROVED').length;
  const rejectedCount = decisions.filter((item) => item === 'REJECTED').length;

  if (approvedCount > 0 && rejectedCount > 0) {
    return 'PARTIALLY_APPROVED';
  }
  if (approvedCount > 0) {
    return 'APPROVED';
  }
  return 'REJECTED';
}

function extractApprovedPatch(
  after: Record<string, unknown>,
  fieldReviews: Record<string, PropertyEditFieldReview>
): EditablePropertyPatch {
  const approvedPatch: Record<string, unknown> = {};
  for (const [key, review] of Object.entries(fieldReviews)) {
    if (review.decision !== 'APPROVED') continue;
    if (Object.prototype.hasOwnProperty.call(after, key)) {
      approvedPatch[key] = after[key];
    }
  }
  return approvedPatch as EditablePropertyPatch;
}

function buildRejectedReviewSummary(
  fieldReviews: Record<string, PropertyEditFieldReview>
): string | null {
  const rejectedItems = Object.entries(fieldReviews)
    .filter(([, review]) => review.decision === 'REJECTED')
    .map(([key, review]) => `${PROPERTY_EDIT_FIELD_LABELS[key] ?? key}: ${review.reason}`);

  if (rejectedItems.length === 0) {
    return null;
  }

  return rejectedItems.join(' | ');
}

const NEGOTIATION_INTERNAL_STATUSES = new Set([
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
  'CANCELLED',
]);

interface AdminNegotiationListRow extends RowDataPacket {
  id: string;
  negotiation_status: string;
  property_id: number;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  property_status: string | null;
  property_code: string | null;
  property_title: string | null;
  property_address: string | null;
  final_value: number | string | null;
  proposal_validity_date: Date | string | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
  client_name: string | null;
  client_cpf: string | null;
  payment_dinheiro: number | string | null;
  payment_permuta: number | string | null;
  payment_financiamento: number | string | null;
  payment_outros: number | string | null;
  last_event_at: Date | string | null;
  approved_at: Date | string | null;
  signed_document_id: number | null;
}

interface AdminNegotiationRequestSummaryRow extends RowDataPacket {
  property_id: number;
  property_code: string | null;
  property_title: string | null;
  property_address: string | null;
  proposal_count: number;
  latest_updated_at: Date | string | null;
  property_image_url: string | null;
  top_negotiation_id: string | null;
  top_proposal_value: number | string | null;
  top_client_name: string | null;
  top_created_at: Date | string | null;
}

interface AdminNegotiationDecisionRow extends RowDataPacket {
  id: string;
  status: string;
  property_id: number;
  capturing_broker_id: number | null;
  buyer_client_id: number | null;
  property_title: string | null;
  property_code: string | null;
  property_address: string | null;
  property_status: string | null;
  lifecycle_status: string | null;
}

interface PendingProposalCountRow extends RowDataPacket {
  cnt: number;
}

interface ExistingContractByNegotiationRow extends RowDataPacket {
  id: string;
}

interface AdminNegotiationBrokerAssignmentRow extends RowDataPacket {
  id: string;
  status: string | null;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
}

interface AdminNegotiationDocumentRow extends RowDataPacket {
  id: number;
  type: string | null;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
}

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
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

function sanitizeDownloadFilename(value: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return 'documento.pdf';
  }
  return sanitized;
}

function buildAttachmentDisposition(filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function parseNegotiationStatusFilter(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'UNDER_REVIEW' || normalized === 'APPROVED') {
    return normalized;
  }
  if (NEGOTIATION_INTERNAL_STATUSES.has(normalized)) {
    return normalized;
  }
  return null;
}

function isInvalidNegotiationStatusFilter(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'string') {
    return true;
  }
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return parseNegotiationStatusFilter(value) === null;
}

function buildNegotiationStatusClause(
  statusFilter: string | null
): { clause: string; params: string[] } {
  if (!statusFilter) {
    return { clause: '', params: [] };
  }

  if (statusFilter === 'UNDER_REVIEW') {
    return {
      clause:
        " AND (n.status IN ('PROPOSAL_SENT', 'DOCUMENTATION_PHASE') OR (n.status = 'IN_NEGOTIATION' AND COALESCE(p.status, '') <> 'negociacao'))",
      params: [],
    };
  }

  if (statusFilter === 'APPROVED' || statusFilter === 'IN_NEGOTIATION') {
    return {
      clause: " AND n.status = 'IN_NEGOTIATION' AND COALESCE(p.status, '') = 'negociacao'",
      params: [],
    };
  }

  return {
    clause: ' AND n.status = ?',
    params: [statusFilter],
  };
}

type NegotiationClientSqlFragments = {
  clientName: string;
  clientCpf: string;
  paymentDinheiro: string;
  paymentPermuta: string;
  paymentFinanciamento: string;
  paymentOutros: string;
};

type NegotiationTimeSqlFragments = {
  nEventAtSelect: string;
  n2EventAtSelect: string;
  nEventSort: string;
  n2EventSort: string;
};

async function resolveNegotiationTimeSqlFragments(): Promise<NegotiationTimeSqlFragments> {
  try {
    const [rows] = await adminDb.query<RowDataPacket[]>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'negotiations'
          AND column_name IN ('updated_at', 'created_at')
      `
    );
    const available = new Set(rows.map((row) => String(row.column_name ?? '').toLowerCase()));
    const hasUpdatedAt = available.has('updated_at');
    const hasCreatedAt = available.has('created_at');

    const nEventAtSelect = hasUpdatedAt
      ? 'COALESCE(n.updated_at, n.created_at)'
      : hasCreatedAt
      ? 'n.created_at'
      : 'NULL';
    const n2EventAtSelect = hasUpdatedAt
      ? 'COALESCE(n2.updated_at, n2.created_at)'
      : hasCreatedAt
      ? 'n2.created_at'
      : 'NULL';

    const nEventSort = hasUpdatedAt
      ? 'COALESCE(n.updated_at, n.created_at)'
      : hasCreatedAt
      ? 'n.created_at'
      : 'n.id';
    const n2EventSort = hasUpdatedAt
      ? 'COALESCE(n2.updated_at, n2.created_at)'
      : hasCreatedAt
      ? 'n2.created_at'
      : 'n2.id';

    return {
      nEventAtSelect,
      n2EventAtSelect,
      nEventSort,
      n2EventSort,
    };
  } catch {
    return {
      nEventAtSelect: 'NULL',
      n2EventAtSelect: 'NULL',
      nEventSort: 'n.id',
      n2EventSort: 'n2.id',
    };
  }
}

async function resolveNegotiationClientSqlFragments(): Promise<NegotiationClientSqlFragments> {
  try {
    const [rows] = await adminDb.query<RowDataPacket[]>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'negotiations'
          AND column_name IN ('client_name', 'client_cpf', 'payment_details')
      `
    );

    const available = new Set(rows.map((row) => String(row.column_name ?? '').toLowerCase()));
    const hasClientName = available.has('client_name');
    const hasClientCpf = available.has('client_cpf');
    const hasPaymentDetails = available.has('payment_details');

    const paymentDetailsClientNameExpr = hasPaymentDetails
      ? `COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientName')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_name')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientName')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_name'))
          )`
      : 'NULL';
    const paymentDetailsClientCpfExpr = hasPaymentDetails
      ? `COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientCpf')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_cpf')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientCpf')),
            JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_cpf'))
          )`
      : 'NULL';

    return {
      clientName: hasClientName
        ? `COALESCE(
            NULLIF(n.client_name, ''),
            ${paymentDetailsClientNameExpr}
          )`
        : paymentDetailsClientNameExpr,
      clientCpf: hasClientCpf
        ? `COALESCE(
            NULLIF(n.client_cpf, ''),
            ${paymentDetailsClientCpfExpr}
          )`
        : paymentDetailsClientCpfExpr,
      paymentDinheiro: hasPaymentDetails
        ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.dinheiro')) AS DECIMAL(12,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.cash')) AS DECIMAL(12,2)),
            0
          )`
        : '0',
      paymentPermuta: hasPaymentDetails
        ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.permuta')) AS DECIMAL(12,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.trade_in')) AS DECIMAL(12,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.tradeIn')) AS DECIMAL(12,2)),
            0
          )`
        : '0',
      paymentFinanciamento: hasPaymentDetails
        ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.financiamento')) AS DECIMAL(12,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.financing')) AS DECIMAL(12,2)),
            0
          )`
        : '0',
      paymentOutros: hasPaymentDetails
        ? `COALESCE(
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.outros')) AS DECIMAL(12,2)),
            CAST(JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.others')) AS DECIMAL(12,2)),
            0
          )`
        : '0',
    };
  } catch {
    return {
      clientName: 'NULL',
      clientCpf: 'NULL',
      paymentDinheiro: '0',
      paymentPermuta: '0',
      paymentFinanciamento: '0',
      paymentOutros: '0',
    };
  }
}

function toNegotiationMoney(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(2));
}

function toNullableIsoDate(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function toAdminNegotiationStatus(row: AdminNegotiationListRow): string {
  const negotiationStatus = String(row.negotiation_status ?? '').toUpperCase();
  const propertyStatus = String(row.property_status ?? '').toLowerCase();

  if (
    negotiationStatus === 'PROPOSAL_SENT' ||
    negotiationStatus === 'DOCUMENTATION_PHASE' ||
    (negotiationStatus === 'IN_NEGOTIATION' && propertyStatus !== 'negociacao')
  ) {
    return 'UNDER_REVIEW';
  }

  if (negotiationStatus === 'IN_NEGOTIATION' && propertyStatus === 'negociacao') {
    return 'APPROVED';
  }

  return negotiationStatus;
}

function mapAdminNegotiation(row: AdminNegotiationListRow) {
  return {
    id: row.id,
    status: toAdminNegotiationStatus(row),
    internalStatus: String(row.negotiation_status ?? '').toUpperCase(),
    propertyId: Number(row.property_id),
    propertyCode: row.property_code ?? null,
    propertyTitle: row.property_title ?? null,
    propertyAddress: row.property_address ?? null,
    capturingBrokerId: row.capturing_broker_id != null ? Number(row.capturing_broker_id) : null,
    sellingBrokerId: row.selling_broker_id != null ? Number(row.selling_broker_id) : null,
    brokerName: row.capturing_broker_name ?? row.selling_broker_name ?? null,
    capturingBrokerName: row.capturing_broker_name ?? null,
    sellingBrokerName: row.selling_broker_name ?? null,
    clientName: row.client_name ?? null,
    clientCpf: row.client_cpf ?? null,
    value: toNullableNumber(row.final_value),
    validityDate: row.proposal_validity_date ? String(row.proposal_validity_date) : null,
    payment: {
      dinheiro: toNegotiationMoney(row.payment_dinheiro),
      permuta: toNegotiationMoney(row.payment_permuta),
      financiamento: toNegotiationMoney(row.payment_financiamento),
      outros: toNegotiationMoney(row.payment_outros),
    },
    updatedAt: row.last_event_at ? String(row.last_event_at) : null,
    approvedAt: row.approved_at ? String(row.approved_at) : null,
    signedDocumentId: row.signed_document_id != null ? Number(row.signed_document_id) : null,
  };
}

function resolveNegotiationPropertyTitle(value: unknown): string {
  const title = String(value ?? '').trim();
  return title.length > 0 ? title : 'Imóvel sem título';
}

async function fetchPropertyOwner(propertyId: number): Promise<{ ownerId: number | null; title: string }> {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    'SELECT broker_id, owner_id, title FROM properties WHERE id = ?',
    [propertyId],
  );
  if (!rows || rows.length === 0) {
    return { ownerId: null, title: '' };
  }
  const row = rows[0];
  const brokerId = row.broker_id != null ? Number(row.broker_id) : null;
  const ownerId = row.owner_id != null ? Number(row.owner_id) : null;
  const title = typeof row.title === 'string' ? row.title : '';
  const resolvedOwner = Number.isFinite(brokerId ?? NaN) ? brokerId : Number.isFinite(ownerId ?? NaN) ? ownerId : null;
  return { ownerId: resolvedOwner, title };
}

async function notifyBrokerApprovedChange(brokerId: number): Promise<void> {
  try {
    await notifyAdmins(`Corretor #${brokerId} aprovado pelo admin.`, 'broker', brokerId);
  } catch (notifyError) {
    console.error('Erro ao notificar admins sobre aprovacao de corretor:', notifyError);
  }

  try {
    const role = await resolveUserNotificationRole(brokerId);
    if (role === 'broker') {
      await notifyUsers({
        message: 'Sua conta de corretor foi aprovada. Voce ja pode anunciar imoveis.',
        recipientIds: [brokerId],
        recipientRole: 'broker',
        relatedEntityType: 'broker',
        relatedEntityId: brokerId,
      });
    }
  } catch (notifyError) {
    console.error('Erro ao notificar corretor aprovado:', notifyError);
  }
}

async function notifyBrokerRejectedChange(brokerId: number): Promise<void> {
  try {
    await notifyAdmins(`Corretor #${brokerId} rejeitado pelo admin.`, 'broker', brokerId);
  } catch (notifyError) {
    console.error('Erro ao notificar admins sobre rejeicao de corretor:', notifyError);
  }

  try {
    await notifyUsers({
      message: 'Sua solicitacao para se tornar corretor foi rejeitada.',
      recipientIds: [brokerId],
      recipientRole: 'client',
      relatedEntityType: 'broker',
      relatedEntityId: brokerId,
    });
  } catch (notifyError) {
    console.error('Erro ao notificar rejeicao de corretor:', notifyError);
  }
}

class AdminController {
  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha sao obrigatorios.' });
    }

    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        'SELECT id, name, email, password_hash, token_version FROM admins WHERE email = ?',
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const admin = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(admin.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais invalidas.' });
      }

      const token = signAdminToken(admin.id, admin.token_version);

      delete (admin as any).password_hash;
      return res.status(200).json({ admin, token });
    } catch (error) {
      console.error('Erro no login do admin:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async logout(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!Number.isFinite(adminId) || adminId <= 0) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      const [result] = await adminDb.query<ResultSetHeader>(
        'UPDATE admins SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
        [adminId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Administrador nao encontrado.' });
      }

      return res.status(200).json({ message: 'Logout realizado com sucesso.' });
    } catch (error) {
      console.error('Erro no logout do admin:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async reauth(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);
    const password = String((req.body as { password?: unknown })?.password ?? '').trim();

    if (!Number.isFinite(adminId) || adminId <= 0) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    if (!password) {
      return res.status(400).json({ error: 'Senha atual do administrador e obrigatoria.' });
    }

    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        'SELECT id, password_hash, token_version FROM admins WHERE id = ? LIMIT 1',
        [adminId],
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Administrador nao encontrado.' });
      }

      const admin = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(admin.password_hash ?? ''));
      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Senha administrativa incorreta.' });
      }

      const reauthToken = signAdminReauthToken(adminId, admin.token_version);
      return res.status(200).json({
        reauthToken,
        expiresInSeconds: 600,
      });
    } catch (error) {
      console.error('Erro ao reautenticar administrador:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listNegotiations(req: Request, res: Response) {
    try {
      if (isInvalidNegotiationStatusFilter(req.query.status)) {
        return res.status(400).json({ error: 'status inválido.' });
      }

      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
      const offset = (page - 1) * limit;
      const statusFilter = parseNegotiationStatusFilter(req.query.status);
      const { clause, params } = buildNegotiationStatusClause(statusFilter);
      const clientSql = await resolveNegotiationClientSqlFragments();

      const [countRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE 1 = 1
          ${clause}
        `,
        params
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await adminDb.query<AdminNegotiationListRow[]>(
        `
          SELECT
            n.id,
            n.status AS negotiation_status,
            n.property_id,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.status AS property_status,
            p.code AS property_code,
            p.title AS property_title,
            CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
            n.final_value,
            n.proposal_validity_date,
            capture_user.name AS capturing_broker_name,
            seller_user.name AS selling_broker_name,
            ${clientSql.clientName} AS client_name,
            ${clientSql.clientCpf} AS client_cpf,
            ${clientSql.paymentDinheiro} AS payment_dinheiro,
            ${clientSql.paymentPermuta} AS payment_permuta,
            ${clientSql.paymentFinanciamento} AS payment_financiamento,
            ${clientSql.paymentOutros} AS payment_outros,
            latest_history.created_at AS last_event_at,
            approved_history.approved_at AS approved_at,
            signed_doc.id AS signed_document_id
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
          LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
          LEFT JOIN (
            SELECT
              h.negotiation_id,
              h.created_at
            FROM negotiation_history h
            INNER JOIN (
              SELECT negotiation_id, MAX(id) AS max_id
              FROM negotiation_history
              GROUP BY negotiation_id
            ) hm ON hm.negotiation_id = h.negotiation_id AND h.id = hm.max_id
          ) latest_history ON latest_history.negotiation_id = n.id
          LEFT JOIN (
            SELECT
              h.negotiation_id,
              MAX(h.created_at) AS approved_at
            FROM negotiation_history h
            WHERE h.to_status = 'IN_NEGOTIATION'
            GROUP BY h.negotiation_id
          ) approved_history ON approved_history.negotiation_id = n.id
          LEFT JOIN (
            SELECT
              d.negotiation_id,
              d.id
            FROM negotiation_documents d
            INNER JOIN (
              SELECT negotiation_id, MAX(id) AS max_id
              FROM negotiation_documents
              WHERE type = 'other'
              GROUP BY negotiation_id
            ) dm ON dm.negotiation_id = d.negotiation_id AND d.id = dm.max_id
          ) signed_doc ON signed_doc.negotiation_id = n.id
          WHERE 1 = 1
          ${clause}
          ORDER BY COALESCE(latest_history.created_at, approved_history.approved_at) DESC, n.id DESC
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.status(200).json({
        data: rows.map(mapAdminNegotiation),
        page,
        limit,
        total,
      });
    } catch (error) {
      console.error('Erro ao listar negociações para admin:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listNegotiationRequestSummary(req: Request, res: Response) {
    try {
      if (isInvalidNegotiationStatusFilter(req.query.status)) {
        return res.status(400).json({ error: 'status inválido.' });
      }

      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const statusFilter = parseNegotiationStatusFilter(req.query.status) ?? 'UNDER_REVIEW';
      const { clause, params } = buildNegotiationStatusClause(statusFilter);
      const clauseForN2 = clause.replace(/n\./g, 'n2.').replace(/p\./g, 'p2.');
      const clientSql = await resolveNegotiationClientSqlFragments();
      const timeSql = await resolveNegotiationTimeSqlFragments();

      const [countRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(DISTINCT n.property_id) AS total
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE 1 = 1
          ${clause}
        `,
        params
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await adminDb.query<AdminNegotiationRequestSummaryRow[]>(
        `
          SELECT
            g.property_id,
            g.property_code,
            g.property_title,
            g.property_address,
            g.proposal_count,
            g.latest_updated_at,
            (
              SELECT pi.image_url
              FROM property_images pi
              WHERE pi.property_id = g.property_id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS property_image_url,
            r.negotiation_id AS top_negotiation_id,
            r.final_value AS top_proposal_value,
            r.client_name AS top_client_name,
            r.created_at AS top_created_at
          FROM (
            SELECT
              n.property_id,
              MAX(p.code) AS property_code,
              MAX(p.title) AS property_title,
              MAX(CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state)) AS property_address,
              COUNT(*) AS proposal_count,
              MAX(${timeSql.nEventAtSelect}) AS latest_updated_at
            FROM negotiations n
            JOIN properties p ON p.id = n.property_id
            WHERE 1 = 1
            ${clause}
            GROUP BY n.property_id
          ) g
          JOIN (
            SELECT
              n.id AS negotiation_id,
              n.property_id,
              COALESCE(n.final_value, 0) AS final_value,
              ${timeSql.nEventAtSelect} AS updated_at,
              ${timeSql.nEventSort} AS sort_value,
              ${timeSql.nEventAtSelect} AS created_at,
              ${clientSql.clientName} AS client_name
            FROM negotiations n
            JOIN properties p ON p.id = n.property_id
            WHERE 1 = 1
            ${clause}
          ) r ON r.property_id = g.property_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM (
              SELECT
                n2.id AS negotiation_id,
                n2.property_id,
                COALESCE(n2.final_value, 0) AS final_value,
                ${timeSql.n2EventAtSelect} AS updated_at,
                ${timeSql.n2EventSort} AS sort_value
              FROM negotiations n2
              JOIN properties p2 ON p2.id = n2.property_id
              WHERE 1 = 1
              ${clauseForN2}
            ) r2
            WHERE r2.property_id = r.property_id
              AND (
                r2.final_value > r.final_value
                OR (r2.final_value = r.final_value AND r2.sort_value > r.sort_value)
                OR (
                  r2.final_value = r.final_value
                  AND r2.sort_value = r.sort_value
                  AND r2.negotiation_id > r.negotiation_id
                )
              )
          )
          ORDER BY g.latest_updated_at DESC, g.property_id DESC
          LIMIT ? OFFSET ?
        `,
        [...params, ...params, ...params, limit, offset]
      );

      return res.status(200).json({
        data: rows.map((row) => ({
          propertyId: Number(row.property_id),
          propertyCode: row.property_code ?? null,
          propertyTitle: row.property_title ?? null,
          propertyAddress: row.property_address ?? null,
          propertyImageUrl: row.property_image_url ?? null,
          proposalCount: Number(row.proposal_count ?? 0),
          updatedAt: toNullableIsoDate(row.latest_updated_at),
          topProposal: {
            negotiationId: row.top_negotiation_id ?? null,
            value: toNullableNumber(row.top_proposal_value),
            clientName: row.top_client_name ?? null,
            createdAt: toNullableIsoDate(row.top_created_at),
          },
        })),
        page,
        limit,
        total,
      });
    } catch (error) {
      console.error('Erro ao listar resumo de solicitações por imóvel:', {
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
        code: (error as { code?: unknown })?.code ?? null,
        errno: (error as { errno?: unknown })?.errno ?? null,
        sqlMessage: (error as { sqlMessage?: unknown })?.sqlMessage ?? null,
      });
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listNegotiationRequestsByProperty(req: Request, res: Response) {
    try {
      const propertyId = Number(req.params.propertyId);
      if (!Number.isInteger(propertyId) || propertyId <= 0) {
        return res.status(400).json({ error: 'propertyId inválido.' });
      }

      if (isInvalidNegotiationStatusFilter(req.query.status)) {
        return res.status(400).json({ error: 'status inválido.' });
      }

      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const statusFilter = parseNegotiationStatusFilter(req.query.status) ?? 'UNDER_REVIEW';
      const { clause, params } = buildNegotiationStatusClause(statusFilter);
      const clientSql = await resolveNegotiationClientSqlFragments();
      const timeSql = await resolveNegotiationTimeSqlFragments();

      const [countRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE n.property_id = ?
          ${clause}
        `,
        [propertyId, ...params]
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await adminDb.query<AdminNegotiationListRow[]>(
        `
          SELECT
            n.id,
            n.status AS negotiation_status,
            n.property_id,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.status AS property_status,
            p.code AS property_code,
            p.title AS property_title,
            CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
            n.final_value,
            n.proposal_validity_date,
            capture_user.name AS capturing_broker_name,
            seller_user.name AS selling_broker_name,
            ${clientSql.clientName} AS client_name,
            ${clientSql.clientCpf} AS client_cpf,
            ${clientSql.paymentDinheiro} AS payment_dinheiro,
            ${clientSql.paymentPermuta} AS payment_permuta,
            ${clientSql.paymentFinanciamento} AS payment_financiamento,
            ${clientSql.paymentOutros} AS payment_outros,
            ${timeSql.nEventAtSelect} AS last_event_at,
            NULL AS approved_at,
            signed_doc.id AS signed_document_id
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
          LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
          LEFT JOIN (
            SELECT
              d.negotiation_id,
              d.id
            FROM negotiation_documents d
            INNER JOIN (
              SELECT negotiation_id, MAX(id) AS max_id
              FROM negotiation_documents
              WHERE type = 'other'
              GROUP BY negotiation_id
            ) dm ON dm.negotiation_id = d.negotiation_id AND d.id = dm.max_id
          ) signed_doc ON signed_doc.negotiation_id = n.id
          WHERE n.property_id = ?
          ${clause}
          ORDER BY COALESCE(n.final_value, 0) DESC, ${timeSql.nEventSort} DESC, n.id DESC
          LIMIT ? OFFSET ?
        `,
        [propertyId, ...params, limit, offset]
      );

      return res.status(200).json({
        data: rows.map(mapAdminNegotiation),
        page,
        limit,
        total,
        propertyId,
      });
    } catch (error) {
      console.error('Erro ao listar solicitações por imóvel:', {
        propertyId: req.params.propertyId,
        status: req.query.status,
        page: req.query.page,
        limit: req.query.limit,
        code: (error as { code?: unknown })?.code ?? null,
        errno: (error as { errno?: unknown })?.errno ?? null,
        sqlMessage: (error as { sqlMessage?: unknown })?.sqlMessage ?? null,
      });
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async approveNegotiation(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);

    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const [rows] = await tx.query<AdminNegotiationDecisionRow[]>(
        `
          SELECT
            n.id,
            n.status,
            n.property_id,
            n.capturing_broker_id,
            p.title AS property_title,
            p.code AS property_code,
            CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
            p.status AS property_status,
            p.lifecycle_status
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE n.id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      if (!rows.length) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const negotiation = rows[0];
      const currentStatus = String(negotiation.status ?? '').toUpperCase();

      if (currentStatus === 'CANCELLED' || currentStatus === 'SOLD' || currentStatus === 'RENTED') {
        await tx.rollback();
        return res.status(400).json({ error: 'Não é possível aprovar uma negociação encerrada.' });
      }

      const [signedProposalRows] = await tx.query<RowDataPacket[]>(
        `
          SELECT id
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND type = 'other'
            AND document_type = 'contrato_assinado'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );
      if (signedProposalRows.length === 0) {
        await tx.rollback();
        return res.status(400).json({
          error: 'Não é possível aprovar sem PDF assinado. Envie a proposta assinada antes de aprovar.',
          code: 'SIGNED_PROPOSAL_REQUIRED',
        });
      }

      await tx.query(
        `
          UPDATE negotiations
          SET status = 'IN_NEGOTIATION', version = version + 1
          WHERE id = ?
        `,
        [negotiationId]
      );

      await tx.query(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES (UUID(), ?, ?, 'IN_NEGOTIATION', ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          negotiationId,
          currentStatus,
          actorId,
          JSON.stringify({
            action: 'admin_approved',
          }),
        ]
      );

      await tx.query(
        `
          UPDATE properties
          SET status = 'negociacao', visibility = 'HIDDEN', lifecycle_status = 'AVAILABLE'
          WHERE id = ?
        `,
        [negotiation.property_id]
      );

      const [existingContractRows] = await tx.query<ExistingContractByNegotiationRow[]>(
        `
          SELECT id
          FROM contracts
          WHERE negotiation_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      if (existingContractRows.length === 0) {
        await tx.query(
          `
            INSERT INTO contracts (
              id,
              negotiation_id,
              property_id,
              status,
              seller_approval_status,
              buyer_approval_status,
              created_at,
              updated_at
            ) VALUES (
              UUID(),
              ?,
              ?,
              'AWAITING_DOCS',
              'PENDING',
              'PENDING',
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
          `,
          [negotiationId, negotiation.property_id]
        );
      }

      await tx.query(
        `
          UPDATE negotiations
          SET status = 'CANCELLED', version = version + 1
          WHERE property_id = ?
            AND id <> ?
            AND UPPER(TRIM(status)) IN (
              'PROPOSAL_SENT',
              'PROPOSAL_DRAFT',
              'DOCUMENTATION_PHASE',
              'CONTRACT_DRAFTING',
              'AWAITING_SIGNATURES'
            )
        `,
        [negotiation.property_id, negotiationId]
      );

      await tx.commit();

      const recipientBrokerId = Number(negotiation.capturing_broker_id ?? 0);
      if (Number.isFinite(recipientBrokerId) && recipientBrokerId > 0) {
        const propertyTitle = resolveNegotiationPropertyTitle(negotiation.property_title);
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Proposta Aprovada!',
            message:
              'Sua proposta foi aprovada! Acesse a aba Contratos no aplicativo para enviar a documentação.',
            recipientId: recipientBrokerId,
            relatedEntityId: Number(negotiation.property_id),
            metadata: {
              negotiationId,
              propertyId: Number(negotiation.property_id),
              status: 'APPROVED',
            },
          });
        } catch (notifyError) {
          console.error('Erro ao notificar corretor sobre aprovação da proposta:', notifyError);
        }
      }

      return res.status(200).json({
        message: 'Negociação aprovada com sucesso.',
        id: negotiationId,
        status: 'APPROVED',
        internalStatus: 'IN_NEGOTIATION',
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao aprovar negociação:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async rejectNegotiation(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();

    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Motivo da rejeição é obrigatório.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const [rows] = await tx.query<AdminNegotiationDecisionRow[]>(
        `
          SELECT
            n.id,
            n.status,
            n.property_id,
            n.capturing_broker_id,
            n.buyer_client_id,
            p.title AS property_title,
            p.code AS property_code,
            CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
            p.status AS property_status,
            p.lifecycle_status
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE n.id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      if (!rows.length) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const negotiation = rows[0];
      const currentStatus = String(negotiation.status ?? '').toUpperCase();

      if (currentStatus === 'SOLD' || currentStatus === 'RENTED') {
        await tx.rollback();
        return res.status(400).json({ error: 'Negociação já finalizada, rejeição não permitida.' });
      }

      const [pendingBeforeRows] = await tx.query<PendingProposalCountRow[]>(
        `
          SELECT COUNT(*) AS cnt
          FROM negotiations
          WHERE property_id = ?
            AND UPPER(TRIM(status)) IN ('PROPOSAL_SENT', 'PROPOSAL_DRAFT')
        `,
        [negotiation.property_id]
      );
      const pendingProposalCount = Number(pendingBeforeRows[0]?.cnt ?? 0);

      await tx.query(`DELETE FROM negotiation_proposal_idempotency WHERE negotiation_id = ?`, [
        negotiationId,
      ]);
      await tx.query(`DELETE FROM negotiations WHERE id = ?`, [negotiationId]);

      if (pendingProposalCount <= 1) {
        await tx.query(
          `
            UPDATE properties
            SET status = 'approved', visibility = 'PUBLIC', lifecycle_status = 'AVAILABLE'
            WHERE id = ?
              AND lifecycle_status NOT IN ('SOLD', 'RENTED')
              AND status NOT IN ('sold', 'rented')
          `,
          [negotiation.property_id]
        );
      }

      await tx.commit();

      const propertyTitle = resolveNegotiationPropertyTitle(negotiation.property_title);
      const recipientBrokerId = Number(negotiation.capturing_broker_id ?? 0);
      const recipientClientId = Number(negotiation.buyer_client_id ?? 0);

      const notifyIds = new Set<number>();
      if (Number.isFinite(recipientBrokerId) && recipientBrokerId > 0) {
        notifyIds.add(recipientBrokerId);
      }
      if (Number.isFinite(recipientClientId) && recipientClientId > 0) {
        notifyIds.add(recipientClientId);
      }

      for (const recipientId of notifyIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Proposta rejeitada',
            message: `Sua proposta para o imóvel ${propertyTitle} foi rejeitada. Motivo: ${reason}.`,
            recipientId,
            relatedEntityId: Number(negotiation.property_id),
            metadata: {
              negotiationId,
              propertyId: Number(negotiation.property_id),
              reason,
              status: 'REJECTED',
            },
          });
        } catch (notifyError) {
          console.error('Erro ao notificar sobre rejeição da proposta:', notifyError);
        }
      }

      return res.status(200).json({
        message: 'Negociação rejeitada e imóvel devolvido para disponível.',
        id: negotiationId,
        status: 'REJECTED',
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao rejeitar negociação:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async cancelNegotiation(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();

    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    if (reason.length < 5) {
      return res.status(400).json({ error: 'Motivo obrigatório com no mínimo 5 caracteres.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const [rows] = await tx.query<AdminNegotiationDecisionRow[]>(
        `
          SELECT
            n.id,
            n.status,
            n.property_id,
            n.capturing_broker_id,
            p.title AS property_title,
            p.code AS property_code,
            CONCAT_WS(', ', p.address, p.numero, p.bairro, p.city, p.state) AS property_address,
            p.status AS property_status,
            p.lifecycle_status
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE n.id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      if (!rows.length) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const negotiation = rows[0];
      const currentStatus = String(negotiation.status ?? '').toUpperCase();
      const propertyStatus = String(negotiation.property_status ?? '').toLowerCase();

      if (currentStatus === 'SOLD' || currentStatus === 'RENTED') {
        await tx.rollback();
        return res.status(400).json({ error: 'Negociação já finalizada, cancelamento não permitido.' });
      }

      if (currentStatus !== 'IN_NEGOTIATION' || propertyStatus !== 'negociacao') {
        await tx.rollback();
        return res.status(400).json({ error: 'Somente negociações em andamento podem ser canceladas.' });
      }

      await tx.query(
        `
          UPDATE negotiations
          SET status = 'CANCELLED', version = version + 1
          WHERE id = ?
        `,
        [negotiationId]
      );

      await tx.query(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES (UUID(), ?, ?, 'CANCELLED', ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          negotiationId,
          currentStatus,
          actorId,
          JSON.stringify({
            action: 'admin_cancelled',
            reason,
          }),
        ]
      );

      await tx.query(
        `
          UPDATE properties
          SET status = 'approved', visibility = 'PUBLIC', lifecycle_status = 'AVAILABLE'
          WHERE id = ?
            AND lifecycle_status NOT IN ('SOLD', 'RENTED')
            AND status NOT IN ('sold', 'rented')
        `,
        [negotiation.property_id]
      );

      await tx.commit();

      const recipientBrokerId = Number(negotiation.capturing_broker_id ?? 0);
      if (Number.isFinite(recipientBrokerId) && recipientBrokerId > 0) {
        const propertyTitle = resolveNegotiationPropertyTitle(negotiation.property_title);
        const brokerMessage = `A negociação para o imóvel ${propertyTitle} foi cancelada. O imóvel voltou para a vitrine. Motivo: ${reason}.`;

        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Negociação Cancelada ⚠️',
            message: brokerMessage,
            recipientId: recipientBrokerId,
            relatedEntityId: Number(negotiation.property_id),
            recipientRole: 'broker',
            metadata: {
              negotiationId,
              propertyId: Number(negotiation.property_id),
              reason,
              status: 'CANCELLED',
            },
          });

          await sendPushNotifications({
            message: brokerMessage,
            recipientIds: [recipientBrokerId],
            relatedEntityType: 'negotiation',
            relatedEntityId: Number(negotiation.property_id),
          });
        } catch (notifyError) {
          console.error('Erro ao notificar corretor sobre cancelamento da negociação:', notifyError);
        }
      }

      return res.status(200).json({
        message: 'Negociação cancelada e imóvel devolvido para disponível.',
        id: negotiationId,
        status: 'CANCELLED',
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao cancelar negociação:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async updateNegotiationSellingBroker(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }
    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    const sameAsCapturingInput = (req.body as { sameAsCapturing?: unknown })?.sameAsCapturing;
    const sameAsCapturing =
      sameAsCapturingInput === undefined ? true : Boolean(sameAsCapturingInput);
    const sellerBrokerIdRaw = (req.body as { sellingBrokerId?: unknown })?.sellingBrokerId;
    const parsedSellerBrokerId =
      sellerBrokerIdRaw === undefined || sellerBrokerIdRaw === null || sellerBrokerIdRaw === ''
        ? null
        : Number(sellerBrokerIdRaw);
    if (
      parsedSellerBrokerId !== null &&
      (!Number.isInteger(parsedSellerBrokerId) || parsedSellerBrokerId <= 0)
    ) {
      return res.status(400).json({ error: 'ID do corretor vendedor inválido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();
      const [rows] = await tx.query<AdminNegotiationBrokerAssignmentRow[]>(
        `
          SELECT id, status, capturing_broker_id, selling_broker_id
          FROM negotiations
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );
      const negotiation = rows[0];
      if (!negotiation) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const capturingBrokerId = Number(negotiation.capturing_broker_id ?? 0);
      if (!Number.isInteger(capturingBrokerId) || capturingBrokerId <= 0) {
        await tx.rollback();
        return res.status(400).json({ error: 'Corretor captador inválido na negociação.' });
      }

      const currentStatus = String(negotiation.status ?? '').trim().toUpperCase();
      if (currentStatus === 'CANCELLED' || currentStatus === 'SOLD' || currentStatus === 'RENTED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Não é possível alterar o corretor vendedor em uma negociação encerrada.',
        });
      }

      let newSellerBrokerId = capturingBrokerId;
      let newSellerBrokerName = '';
      if (!sameAsCapturing) {
        if (parsedSellerBrokerId === null) {
          await tx.rollback();
          return res.status(400).json({ error: 'Selecione um corretor vendedor.' });
        }
        newSellerBrokerId = parsedSellerBrokerId;
      }

      if (newSellerBrokerId !== capturingBrokerId) {
        const [sellerRows] = await tx.query<RowDataPacket[]>(
          `
            SELECT u.name
            FROM brokers b
            JOIN users u ON u.id = b.id
            WHERE b.id = ? AND b.status = 'approved'
            LIMIT 1
          `,
          [newSellerBrokerId]
        );
        newSellerBrokerName = String(sellerRows[0]?.name ?? '').trim();
        if (!newSellerBrokerName) {
          await tx.rollback();
          return res.status(400).json({ error: 'Corretor vendedor inválido ou não aprovado.' });
        }
      } else {
        const [capturingRows] = await tx.query<RowDataPacket[]>(
          `SELECT name FROM users WHERE id = ? LIMIT 1`,
          [capturingBrokerId]
        );
        newSellerBrokerName = String(capturingRows[0]?.name ?? '').trim() || '';
      }

      await tx.query(
        `
          UPDATE negotiations
          SET selling_broker_id = ?, version = version + 1
          WHERE id = ?
        `,
        [newSellerBrokerId, negotiationId]
      );

      await tx.commit();
      return res.status(200).json({
        message: 'Corretor vendedor atualizado com sucesso.',
        negotiationId,
        capturingBrokerId,
        sellingBrokerId: newSellerBrokerId,
        sameAsCapturing: newSellerBrokerId === capturingBrokerId,
        sellingBrokerName: newSellerBrokerName || null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao atualizar corretor vendedor da negociação (admin):', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async downloadSignedProposal(req: Request, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    try {
      const [rows] = await adminDb.query<AdminNegotiationDocumentRow[]>(
        `
          SELECT
            id,
            type,
            document_type,
            metadata_json,
            storage_provider,
            storage_bucket,
            storage_key,
            storage_content_type,
            storage_size_bytes,
            storage_etag
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND type = 'other'
            AND document_type = 'contrato_assinado'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
        [negotiationId]
      );

      const document = rows[0];
      if (!document) {
        return res.status(404).json({ error: 'Proposta assinada não encontrada.' });
      }

      const fileContent = await readNegotiationDocumentObject(document);

      const metadata = parseJsonObjectSafe(document.metadata_json);
      const originalFileName = String(metadata.originalFileName ?? '').trim();
      const fallbackType = String(document.document_type ?? document.type ?? 'proposta_assinada')
        .trim()
        .toLowerCase();
      const filename =
        originalFileName ||
        `${fallbackType || 'proposta_assinada'}_${negotiationId}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', buildAttachmentDisposition(filename));
      res.setHeader('Content-Length', fileContent.length.toString());

      return res.status(200).send(fileContent);
    } catch (error) {
      console.error('Erro ao baixar proposta assinada:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async uploadSignedProposal(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }
    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile || !uploadedFile.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'PDF assinado não enviado.' });
    }
    const mime = String(uploadedFile.mimetype ?? '').toLowerCase();
    if (mime && mime !== 'application/pdf') {
      return res.status(400).json({ error: 'Arquivo inválido. Envie apenas PDF assinado.' });
    }

    const tx = await adminDb.getConnection();
    let previousDocumentToDelete: AdminNegotiationDocumentRow | null = null;
    try {
      await tx.beginTransaction();
      const [negotiationRows] = await tx.query<RowDataPacket[]>(
        `
          SELECT id, status
          FROM negotiations
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );
      if (negotiationRows.length === 0) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const currentStatus = String(negotiationRows[0]?.status ?? '').trim().toUpperCase();
      if (currentStatus === 'CANCELLED' || currentStatus === 'SOLD' || currentStatus === 'RENTED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Não é possível enviar PDF assinado para uma negociação encerrada.',
        });
      }

      const [existingRows] = await tx.query<AdminNegotiationDocumentRow[]>(
        `
          SELECT
            id,
            type,
            document_type,
            metadata_json,
            storage_provider,
            storage_bucket,
            storage_key,
            storage_content_type,
            storage_size_bytes,
            storage_etag
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND type = 'other'
            AND document_type = 'contrato_assinado'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );
      const existingDocument = existingRows[0];
      if (existingDocument) {
        await tx.query('DELETE FROM negotiation_documents WHERE id = ?', [existingDocument.id]);
        previousDocumentToDelete = existingDocument;
      }

      const documentId = await saveNegotiationSignedProposalDocument(
        negotiationId,
        uploadedFile.buffer,
        tx,
        {
          originalFileName: uploadedFile.originalname ?? 'proposta_assinada_admin.pdf',
          uploadedBy: actorId,
          uploadedByRole: 'admin',
          uploadedAt: new Date().toISOString(),
          source: 'admin_panel',
        }
      );

      await tx.commit();
      if (previousDocumentToDelete) {
        await deleteNegotiationDocumentObject(previousDocumentToDelete).catch((storageError) => {
          console.error('Falha ao excluir PDF assinado anterior no storage:', storageError);
        });
      }
      return res.status(201).json({
        message: 'PDF assinado enviado com sucesso.',
        negotiationId,
        documentId,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao enviar PDF assinado (admin):', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async deleteSignedProposal(req: AuthRequest, res: Response) {
    const negotiationId = String(req.params.id ?? '').trim();
    const actorId = Number(req.userId);
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }
    if (!actorId) {
      return res.status(401).json({ error: 'Administrador não autenticado.' });
    }

    const tx = await adminDb.getConnection();
    let documentToDelete: AdminNegotiationDocumentRow | null = null;
    try {
      await tx.beginTransaction();
      const [rows] = await tx.query<AdminNegotiationDocumentRow[]>(
        `
          SELECT
            id,
            type,
            document_type,
            metadata_json,
            storage_provider,
            storage_bucket,
            storage_key,
            storage_content_type,
            storage_size_bytes,
            storage_etag
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND type = 'other'
            AND document_type = 'contrato_assinado'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );
      const document = rows[0];
      if (!document) {
        await tx.rollback();
        return res.status(404).json({ error: 'Proposta assinada não encontrada.' });
      }

      await tx.query('DELETE FROM negotiation_documents WHERE id = ?', [document.id]);
      documentToDelete = document;

      await tx.commit();

      if (documentToDelete) {
        await deleteNegotiationDocumentObject(documentToDelete).catch((storageError) => {
          console.error('Falha ao excluir arquivo no storage da proposta assinada:', storageError);
        });
      }

      return res.status(200).json({
        message: 'PDF assinado removido com sucesso.',
        negotiationId,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao remover PDF assinado (admin):', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async listPropertiesWithBrokers(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const searchTerm = String(req.query.search ?? '').trim();
      const requestedSearchColumn = String(req.query.searchColumn ?? '').trim();
      const status = normalizeStatus(req.query.status);
      const city = String(req.query.city ?? '').trim();
      const sortBy = String(req.query.sortBy ?? 'p.created_at');
      const sortOrder = String(req.query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const allowedSearchColumns = new Set([
        'p.id',
        'p.title',
        'p.type',
        'p.city',
        'p.code',
        'u.name',
        'u_owner.name',
      ]);
      const allowedSortColumns = new Set([
        'p.id',
        'p.title',
        'p.type',
        'p.city',
        'u.name',
        'u_owner.name',
        'p.price',
        'p.created_at',
        'p.code',
        'p.status',
      ]);

      const narrowSearchColumn = allowedSearchColumns.has(requestedSearchColumn)
        ? requestedSearchColumn
        : null;
      const safeSortBy = allowedSortColumns.has(sortBy) ? sortBy : 'p.created_at';

      const whereClauses: string[] = [];
      const params: any[] = [];

      if (searchTerm) {
        if (narrowSearchColumn) {
          whereClauses.push(`${narrowSearchColumn} LIKE ?`);
          params.push(`%${searchTerm}%`);
        } else {
          const like = `%${searchTerm}%`;
          const parts = [
            'p.title LIKE ?',
            'p.city LIKE ?',
            'CAST(p.id AS CHAR) LIKE ?',
            "COALESCE(p.code,'') LIKE ?",
            'p.type LIKE ?',
            "COALESCE(u.name,'') LIKE ?",
            "COALESCE(u_owner.name,'') LIKE ?",
          ];
          const searchParams: unknown[] = [like, like, like, like, like, like, like];
          if (/^\d+$/.test(searchTerm)) {
            const idNum = Number(searchTerm);
            if (Number.isFinite(idNum)) {
              parts.push('p.id = ?');
              searchParams.push(idNum);
            }
          }
          whereClauses.push(`(${parts.join(' OR ')})`);
          params.push(...searchParams);
        }
      }

      if (status) {
        whereClauses.push('p.status = ?');
        params.push(status);
      }

      if (city) {
        whereClauses.push('p.city = ?');
        params.push(city);
      }

      const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const [totalRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON b.id = u.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          ${where}
        `,
        params
      );
      const total = totalRows[0]?.total ?? 0;

      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            p.id,
            p.code,
            p.title,
            p.type,
            p.status,
            p.price,
            p.price_sale,
            p.price_rent,
            p.promotion_percentage,
            p.promotion_price,
            p.promotional_rent_price,
            p.promotional_rent_percentage,
            p.city,
            p.bairro,
            p.cep,
            p.purpose,
            p.created_at,
            p.broker_id,
            p.owner_id,
            p.owner_name,
            p.owner_phone,
            (
              SELECT pi.image_url
              FROM property_images pi
              WHERE pi.property_id = p.id
              ORDER BY pi.id ASC
              LIMIT 1
            ) AS property_image_url,
            COALESCE(u.name, u_owner.name) AS broker_name,
            COALESCE(u.phone, u_owner.phone) AS broker_phone,
            b.status AS broker_status,
            b.creci AS broker_creci
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON b.id = u.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          ${where}
          ORDER BY ${safeSortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.json({ data: rows, total });
    } catch (error) {
      console.error('Erro ao listar imoveis com corretores:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async listPropertyEditRequests(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const requestedStatus = String(req.query.status ?? 'PENDING').trim().toUpperCase();
      const allowedStatuses = new Set([
        'PENDING',
        'APPROVED',
        'REJECTED',
        'PARTIALLY_APPROVED',
        'ALL',
      ]);
      const normalizedStatus = allowedStatuses.has(requestedStatus) ? requestedStatus : 'PENDING';

      const whereClause =
        normalizedStatus === 'ALL' ? '' : 'WHERE per.status = ?';
      const whereParams = normalizedStatus === 'ALL' ? [] : [normalizedStatus];

      const [countRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM property_edit_requests per
          ${whereClause}
        `,
        whereParams
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await adminDb.query<PropertyEditRequestListRow[]>(
        `
          SELECT
            per.id,
            per.property_id,
            per.requester_user_id,
            per.requester_role,
            per.status,
            per.before_json,
            per.after_json,
            per.diff_json,
            per.field_reviews_json,
            per.review_reason,
            per.reviewed_by,
            per.reviewed_at,
            per.created_at,
            per.updated_at,
            p.title AS property_title,
            p.code AS property_code,
            u.name AS requester_name
          FROM property_edit_requests per
          INNER JOIN properties p ON p.id = per.property_id
          INNER JOIN users u ON u.id = per.requester_user_id
          ${whereClause}
          ORDER BY per.created_at DESC, per.id DESC
          LIMIT ? OFFSET ?
        `,
        [...whereParams, limit, offset]
      );

      return res.status(200).json({
        data: rows.map((row) => mapPropertyEditRequest(row)),
        total,
        page,
        limit,
      });
    } catch (error) {
      console.error('Erro ao listar solicitacoes de edicao de imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getPropertyEditRequestById(req: Request, res: Response) {
    const requestId = Number(req.params.id);

    if (Number.isNaN(requestId)) {
      return res.status(400).json({ error: 'Identificador da solicitacao invalido.' });
    }

    try {
      const [rows] = await adminDb.query<PropertyEditRequestListRow[]>(
        `
          SELECT
            per.id,
            per.property_id,
            per.requester_user_id,
            per.requester_role,
            per.status,
            per.before_json,
            per.after_json,
            per.diff_json,
            per.field_reviews_json,
            per.review_reason,
            per.reviewed_by,
            per.reviewed_at,
            per.created_at,
            per.updated_at,
            p.title AS property_title,
            p.code AS property_code,
            u.name AS requester_name
          FROM property_edit_requests per
          INNER JOIN properties p ON p.id = per.property_id
          INNER JOIN users u ON u.id = per.requester_user_id
          WHERE per.id = ?
          LIMIT 1
        `,
        [requestId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Solicitacao de edicao nao encontrada.' });
      }

      return res.status(200).json(mapPropertyEditRequest(rows[0]));
    } catch (error) {
      console.error('Erro ao buscar solicitacao de edicao de imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async reviewPropertyEditRequest(req: AuthRequest, res: Response) {
    const requestId = Number(req.params.id);
    const reviewerId = req.userId ?? null;
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (Number.isNaN(requestId)) {
      return res.status(400).json({ error: 'Identificador da solicitacao invalido.' });
    }

    const db = await adminDb.getConnection();
    let committed = false;
    try {
      await db.beginTransaction();

      const [requestRows] = await db.query<PropertyEditRequestListRow[]>(
        `
          SELECT
            per.id,
            per.property_id,
            per.requester_user_id,
            per.requester_role,
            per.status,
            per.before_json,
            per.after_json,
            per.diff_json,
            per.field_reviews_json,
            per.review_reason,
            per.reviewed_by,
            per.reviewed_at,
            per.created_at,
            per.updated_at,
            p.title AS property_title,
            p.code AS property_code,
            u.name AS requester_name
          FROM property_edit_requests per
          INNER JOIN properties p ON p.id = per.property_id
          INNER JOIN users u ON u.id = per.requester_user_id
          WHERE per.id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [requestId]
      );

      if (requestRows.length === 0) {
        await db.rollback();
        return res.status(404).json({ error: 'Solicitacao de edicao nao encontrada.' });
      }

      const requestRow = requestRows[0];
      if (String(requestRow.status ?? '').toUpperCase() !== 'PENDING') {
        await db.rollback();
        return res.status(409).json({ error: 'Esta solicitacao nao esta mais pendente.' });
      }

      const diff = parseJsonObjectSafe(requestRow.diff_json) as EditablePropertyDiff;
      const diffKeys = Object.keys(diff);
      if (diffKeys.length === 0) {
        await db.rollback();
        return res.status(400).json({ error: 'Esta solicitacao nao possui campos alterados.' });
      }

      let fieldReviews: Record<string, PropertyEditFieldReview>;
      const reviewMode = String(body.mode ?? '').trim().toLowerCase();
      if (reviewMode === 'approve_all') {
        fieldReviews = Object.fromEntries(
          diffKeys.map((key) => [key, { decision: 'APPROVED' as const }])
        );
      } else if (reviewMode === 'reject_all') {
        const reason = String(body.reason ?? '').trim();
        if (!reason) {
          await db.rollback();
          return res.status(400).json({ error: 'Informe o motivo da rejeicao.' });
        }
        fieldReviews = Object.fromEntries(
          diffKeys.map((key) => [
            key,
            { decision: 'REJECTED' as const, reason },
          ])
        );
      } else {
        fieldReviews = normalizeFieldReviews(body.fieldReviews, diff);
      }

      const [propertyRows] = await db.query<RowDataPacket[]>(
        'SELECT * FROM properties WHERE id = ? LIMIT 1 FOR UPDATE',
        [requestRow.property_id]
      );

      if (propertyRows.length === 0) {
        await db.rollback();
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const property = propertyRows[0] as Record<string, unknown>;
      const currentState = buildEditablePropertyState(property);
      const afterPayload = parseJsonObjectSafe(requestRow.after_json);
      const approvedPatch = extractApprovedPatch(afterPayload, fieldReviews);
      const preparedApprovedPatch = preparePropertyEditPatch(
        approvedPatch,
        currentState
      );
      const dbPatch = buildPropertyEditDbPatch(
        currentState,
        preparedApprovedPatch.patch
      );
      const updateStatement = buildUpdateStatementFromPatch(dbPatch);

      if (updateStatement.assignments.length > 0) {
        await db.query(
          `
            UPDATE properties
            SET ${updateStatement.assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [...updateStatement.values, requestRow.property_id]
        );
      }

      const resolvedStatus = resolveReviewedRequestStatus(fieldReviews);
      const rejectedSummary = buildRejectedReviewSummary(fieldReviews);

      await db.query(
        `
          UPDATE property_edit_requests
          SET
            status = ?,
            field_reviews_json = CAST(? AS JSON),
            review_reason = ?,
            reviewed_by = ?,
            reviewed_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          resolvedStatus,
          JSON.stringify(fieldReviews),
          rejectedSummary,
          reviewerId,
          requestId,
        ]
      );

      await db.commit();
      committed = true;

      if (rejectedSummary) {
        try {
          const rawBrokerId = Number(property.broker_id ?? 0);
          const recipientId =
            Number.isFinite(rawBrokerId) && rawBrokerId > 0
              ? rawBrokerId
              : Number(requestRow.requester_user_id);
          const recipientRole = await resolveUserNotificationRole(recipientId);
          const propertyTitle =
            String(requestRow.property_title ?? '').trim() || `Imóvel #${requestRow.property_id}`;

          await notifyUsers({
            message: `A edição do imóvel "${propertyTitle}" teve campos rejeitados: ${rejectedSummary}.`,
            recipientIds: [recipientId],
            recipientRole,
            relatedEntityType: 'property',
            relatedEntityId: Number(requestRow.property_id),
          });
        } catch (notifyError) {
          console.error('Erro ao enviar notificação da revisão parcial:', notifyError);
        }
      }

      return res.status(200).json({
        message: 'Solicitacao de edicao revisada com sucesso.',
        status: resolvedStatus,
        fieldReviews,
      });
    } catch (error: any) {
      if (!committed) {
        await db.rollback();
      }
      if (error?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          error: 'Nao foi possivel concluir a revisao por conflito de dados unicos do imovel.',
        });
      }
      if (error instanceof Error && error.message.trim().length > 0) {
        return res.status(400).json({ error: error.message });
      }
      console.error('Erro ao revisar solicitacao de edicao de imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      db.release();
    }
  }

  async approvePropertyEditRequest(req: AuthRequest, res: Response) {
    req.body = { mode: 'approve_all' };
    return this.reviewPropertyEditRequest(req, res);
  }

  async rejectPropertyEditRequest(req: AuthRequest, res: Response) {
    req.body = { mode: 'reject_all', reason: req.body?.reason };
    return this.reviewPropertyEditRequest(req, res);
  }

  async listArchivedProperties(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;
      const search = String(req.query.search ?? '').trim();
      const statusFilter = String(req.query.status ?? '').trim().toLowerCase();

      const whereClauses: string[] = [];
      const params: Array<string | number> = [];

      if (statusFilter === 'sold' || statusFilter === 'rented') {
        whereClauses.push('p.status = ?');
        params.push(statusFilter);
      } else {
        whereClauses.push("p.status IN ('sold', 'rented')");
      }

      if (search) {
        const like = `%${search}%`;
        const parts = [
          'p.code LIKE ?',
          'p.title LIKE ?',
          'COALESCE(u.name, u_owner.name) LIKE ?',
          'CAST(p.id AS CHAR) LIKE ?',
        ];
        const searchParams: Array<string | number> = [like, like, like, like];
        if (/^\d+$/.test(search)) {
          const idNum = Number(search);
          if (Number.isFinite(idNum)) {
            parts.push('p.id = ?');
            searchParams.push(idNum);
          }
        }
        whereClauses.push(`(${parts.join(' OR ')})`);
        params.push(...searchParams);
      }

      const where = `WHERE ${whereClauses.join(' AND ')}`;

      const [countRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM properties p
          LEFT JOIN brokers b ON b.id = p.broker_id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          ${where}
        `,
        params
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await adminDb.query<ArchivePropertyRow[]>(
        `
          SELECT
            p.id,
            p.code,
            p.title,
            p.status,
            COALESCE(u.name, u_owner.name) AS broker_name,
            sl.last_sale_date AS transaction_date
          FROM properties p
          LEFT JOIN brokers b ON b.id = p.broker_id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          LEFT JOIN (
            SELECT property_id, MAX(sale_date) AS last_sale_date
            FROM sales
            GROUP BY property_id
          ) sl ON sl.property_id = p.id
          ${where}
          ORDER BY COALESCE(sl.last_sale_date, p.created_at) DESC, p.id DESC
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.status(200).json({
        data: rows.map((row) => ({
          id: Number(row.id),
          code: row.code ?? null,
          title: row.title,
          status: row.status,
          brokerName: row.broker_name ?? null,
          transactionDate: row.transaction_date ? String(row.transaction_date) : null,
        })),
        total,
        page,
        limit,
      });
    } catch (error) {
      console.error('Erro ao listar imóveis vendidos/alugados:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async relistProperty(req: AuthRequest, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel inválido.' });
    }

    const db = await adminDb.getConnection();
    try {
      await db.beginTransaction();

      const [rows] = await db.query<RowDataPacket[]>(
        `
          SELECT id, status, code, title
          FROM properties
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [propertyId]
      );

      if (!rows.length) {
        await db.rollback();
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      const property = rows[0];
      const currentStatus = String(property.status ?? '').toLowerCase();
      if (currentStatus !== 'rented' && currentStatus !== 'sold') {
        await db.rollback();
        return res.status(400).json({
          error: 'Apenas imóveis vendidos ou alugados podem ser disponibilizados novamente.',
        });
      }

      await db.query(
        `
          UPDATE properties
          SET
            status = 'approved',
            sale_value = NULL,
            commission_rate = NULL,
            commission_value = NULL
          WHERE id = ?
        `,
        [propertyId]
      );

      const dealType = currentStatus === 'rented' ? 'rent' : 'sale';
      await db.query(
        `
          DELETE FROM sales
          WHERE property_id = ?
            AND deal_type = ?
        `,
        [propertyId, dealType]
      );

      await db.commit();

      return res.status(200).json({
        message: 'Imóvel disponibilizado novamente com sucesso.',
        data: {
          id: Number(property.id),
          code: property.code ?? null,
          title: property.title ?? null,
          status: 'approved',
        },
      });
    } catch (error) {
      await db.rollback();
      console.error('Erro ao disponibilizar imóvel novamente:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      db.release();
    }
  }

  async listFeaturedProperties(req: Request, res: Response) {
    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            fp.property_id AS id,
            fp.position,
            p.title,
            p.city,
            p.state,
            p.status,
            p.price,
            p.price_sale,
            p.price_rent,
            p.promotion_price,
            p.promotional_rent_price,
            p.promotional_rent_percentage,
            p.purpose
          FROM featured_properties fp
          JOIN properties p ON p.id = fp.property_id
          ORDER BY fp.position ASC
        `
      );
      return res.status(200).json({ data: rows });
    } catch (error) {
      console.error('Erro ao listar destaques:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateFeaturedProperties(req: Request, res: Response) {
    const rawList = (req.body as { propertyIds?: unknown })?.propertyIds;
    const input = Array.isArray(rawList) ? rawList : [];
    const seen = new Set<number>();
    const ids: number[] = [];

    for (const value of input) {
      const id = Number(value);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    if (ids.length > 20) {
      return res.status(400).json({ error: 'Limite máximo de 20 destaques.' });
    }

    try {
      if (ids.length > 0) {
        const [approvedRows] = await adminDb.query<RowDataPacket[]>(
          'SELECT id FROM properties WHERE status = ? AND id IN (?)',
          ['approved', ids]
        );
        const approvedIds = new Set<number>(
          approvedRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))
        );
        const invalidIds = ids.filter((id) => !approvedIds.has(id));
        if (invalidIds.length > 0) {
          return res.status(400).json({
            error: 'Alguns imoveis não estão aprovados.',
            invalidIds,
          });
        }
      }

      const db = await adminDb.getConnection();
      try {
        await db.beginTransaction();
        await db.query('DELETE FROM featured_properties');
        if (ids.length > 0) {
          const values = ids.map((id, index) => [id, index + 1]);
          await db.query(
            'INSERT INTO featured_properties (property_id, position) VALUES ?',
            [values]
          );
        }
        await db.commit();
      } catch (error) {
        await db.rollback();
        throw error;
      } finally {
        db.release();
      }

      return res.status(200).json({ data: ids });
    } catch (error) {
      console.error('Erro ao atualizar destaques:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateBroker(req: Request, res: Response) {
    const brokerId = Number(req.params.id);
    const {
      name,
      email,
      phone,
      creci,
      status,
      agencyId,
      agency_id,
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    } = req.body ?? {};
    const resolvedAgencyId = agencyId ?? agency_id;

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    const allowedBrokerStatuses = new Set(['pending_verification', 'approved', 'rejected']);
    const normalizedStatus =
      status === undefined ? undefined : String(status).trim().toLowerCase();
    if (normalizedStatus !== undefined && !allowedBrokerStatuses.has(normalizedStatus)) {
      return res.status(400).json({ error: 'Status de corretor inválido.' });
    }

    const partialAddressInput: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    })) {
      if (value !== undefined) {
        partialAddressInput[key] = value;
      }
    }

    const addressResult =
      Object.keys(partialAddressInput).length > 0
        ? sanitizePartialAddressInput(partialAddressInput)
        : null;
    if (addressResult && !addressResult.ok) {
      return res.status(400).json({
        error: 'Endereco incompleto ou invalido.',
        fields: addressResult.errors,
      });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const snapshot = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
      if (!snapshot || snapshot.broker_id == null) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }

      const userSetParts: string[] = [];
      const userParams: unknown[] = [];

      if (name !== undefined) {
        const normalizedName = stringOrNull(name);
        if (!normalizedName || normalizedName.length > 120) {
          await tx.rollback();
          return res.status(400).json({ error: 'Nome inválido.' });
        }
        userSetParts.push('name = ?');
        userParams.push(normalizedName);
      }

      if (email !== undefined) {
        const normalizedEmail = stringOrNull(email)?.toLowerCase() ?? null;
        if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
          await tx.rollback();
          return res.status(400).json({ error: 'Email inválido.' });
        }
        const [duplicateRows] = await tx.query<RowDataPacket[]>(
          'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
          [normalizedEmail, brokerId],
        );
        if (duplicateRows.length > 0) {
          await tx.rollback();
          return res.status(409).json({ error: 'Email ja cadastrado.' });
        }
        userSetParts.push('email = ?');
        userParams.push(normalizedEmail);
      }

      if (phone !== undefined) {
        if (!hasValidPhone(phone)) {
          await tx.rollback();
          return res.status(400).json({
            error: 'Telefone inválido. Use entre 10 e 13 dígitos com DDD.',
          });
        }
        userSetParts.push('phone = ?');
        userParams.push(normalizePhone(phone));
      }

      if (addressResult?.ok) {
        for (const [key, value] of Object.entries(addressResult.value)) {
          userSetParts.push(`${key} = ?`);
          userParams.push(value);
        }
      }

      if (userSetParts.length > 0) {
        userParams.push(brokerId);
        await tx.query(
          `UPDATE users SET ${userSetParts.join(', ')} WHERE id = ?`,
          userParams,
        );
      }

      const brokerSetParts: string[] = [];
      const brokerParams: unknown[] = [];

      if (creci !== undefined) {
        const normalizedCreciValue = normalizeCreci(creci);
        if (!normalizedCreciValue || !hasValidCreci(normalizedCreciValue)) {
          await tx.rollback();
          return res.status(400).json({ error: 'CRECI inválido.' });
        }
        const [duplicateBrokerRows] = await tx.query<RowDataPacket[]>(
          'SELECT id FROM brokers WHERE creci = ? AND id <> ? LIMIT 1',
          [normalizedCreciValue, brokerId],
        );
        if (duplicateBrokerRows.length > 0) {
          await tx.rollback();
          return res.status(409).json({ error: 'CRECI ja cadastrado.' });
        }
        brokerSetParts.push('creci = ?');
        brokerParams.push(normalizedCreciValue);
      }

      if (resolvedAgencyId !== undefined) {
        const agencyValue =
          resolvedAgencyId === null ||
          resolvedAgencyId === '' ||
          resolvedAgencyId === 0 ||
          resolvedAgencyId === '0'
            ? null
            : Number(resolvedAgencyId);
        if (agencyValue !== null && (!Number.isFinite(agencyValue) || agencyValue <= 0)) {
          await tx.rollback();
          return res.status(400).json({ error: 'Agencia inválida.' });
        }
        brokerSetParts.push('agency_id = ?');
        brokerParams.push(agencyValue);
      }

      if (normalizedStatus === 'pending_verification') {
        brokerSetParts.push('status = ?');
        brokerParams.push(normalizedStatus);
      }

      if (brokerSetParts.length > 0) {
        brokerParams.push(brokerId);
        await tx.query(
          `UPDATE brokers SET ${brokerSetParts.join(', ')} WHERE id = ?`,
          brokerParams,
        );
      }

      let finalRole: 'broker' | 'client' = isActiveBrokerStatus(snapshot.broker_status)
        ? 'broker'
        : 'client';
      let finalStatus = snapshot.broker_status ?? 'rejected';

      if (normalizedStatus === 'approved') {
        const result = await approveBrokerAccount(tx, brokerId);
        if (!result.affected) {
          await tx.rollback();
          return res.status(404).json({ error: 'Corretor nao encontrado.' });
        }
        finalRole = 'broker';
        finalStatus = 'approved';
      } else if (normalizedStatus === 'rejected') {
        const result = await rejectBrokerAccount(tx, brokerId);
        if (!result.affected) {
          await tx.rollback();
          return res.status(404).json({ error: 'Corretor nao encontrado.' });
        }
        finalRole = 'client';
        finalStatus = 'rejected';
      } else if (normalizedStatus === 'pending_verification') {
        finalRole = 'broker';
        finalStatus = 'pending_verification';
      } else if (brokerSetParts.length > 0 || userSetParts.length > 0) {
        const refreshed = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
        finalRole = refreshed && isActiveBrokerStatus(refreshed.broker_status) ? 'broker' : 'client';
        finalStatus = refreshed?.broker_status ?? finalStatus;
      }

      await tx.commit();

      if (normalizedStatus === 'approved') {
        await notifyBrokerApprovedChange(brokerId);
      } else if (normalizedStatus === 'rejected') {
        await notifyBrokerRejectedChange(brokerId);
      }

      return res.status(200).json({
        message: 'Corretor atualizado com sucesso.',
        status: finalStatus,
        role: finalRole,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao atualizar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async updateClient(req: Request, res: Response) {
    const clientId = Number(req.params.id);
    const { name, email, phone, street, number, complement, bairro, city, state, cep } = req.body ?? {};

    if (Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'Identificador de cliente invalido.' });
    }

    const partialAddressInput: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
    })) {
      if (value !== undefined) {
        partialAddressInput[key] = value;
      }
    }

    const addressResult =
      Object.keys(partialAddressInput).length > 0
        ? sanitizePartialAddressInput(partialAddressInput)
        : null;
    if (addressResult && !addressResult.ok) {
      return res.status(400).json({
        error: 'Endereco incompleto ou invalido.',
        fields: addressResult.errors,
      });
    }

    try {
      const snapshot = await loadUserLifecycleSnapshot(adminDb, clientId);
      if (!snapshot) {
        return res.status(404).json({ error: 'Cliente nao encontrado.' });
      }
      if (snapshot.broker_id != null && isActiveBrokerStatus(snapshot.broker_status)) {
        return res.status(400).json({
          error: 'Use a rota de corretores para editar uma conta ativa de corretor.',
        });
      }

      const setParts: string[] = [];
      const params: unknown[] = [];

      if (name !== undefined) {
        const normalizedName = stringOrNull(name);
        if (!normalizedName || normalizedName.length > 120) {
          return res.status(400).json({ error: 'Nome inválido.' });
        }
        setParts.push('name = ?');
        params.push(normalizedName);
      }

      if (email !== undefined) {
        const normalizedEmail = stringOrNull(email)?.toLowerCase() ?? null;
        if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
          return res.status(400).json({ error: 'Email inválido.' });
        }
        const [duplicateRows] = await adminDb.query<RowDataPacket[]>(
          'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
          [normalizedEmail, clientId],
        );
        if (duplicateRows.length > 0) {
          return res.status(409).json({ error: 'Email ja cadastrado.' });
        }
        setParts.push('email = ?');
        params.push(normalizedEmail);
      }

      if (phone !== undefined) {
        if (!hasValidPhone(phone)) {
          return res.status(400).json({
            error: 'Telefone inválido. Use entre 10 e 13 dígitos com DDD.',
          });
        }
        setParts.push('phone = ?');
        params.push(normalizePhone(phone));
      }

      if (addressResult?.ok) {
        for (const [key, value] of Object.entries(addressResult.value)) {
          setParts.push(`${key} = ?`);
          params.push(value);
        }
      }

      if (setParts.length === 0) {
        return res.status(400).json({
          error: 'Nenhum campo valido foi enviado para atualização.',
        });
      }

      params.push(clientId);
      await adminDb.query(
        `UPDATE users SET ${setParts.join(', ')} WHERE id = ?`,
        params,
      );

      return res.status(200).json({
        message: 'Cliente atualizado com sucesso.',
        role: 'client',
      });
    } catch (error) {
      console.error('Erro ao atualizar cliente:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async getAllUsers(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;

      const searchTerm = String(req.query.search ?? '').trim();
      const includeBrokers = String(req.query.includeBrokers ?? '').toLowerCase() === 'true';
      const sortByParam = String(req.query.sortBy ?? '').toLowerCase();
      const sortOrder = String(req.query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      const sortMap: Record<string, string> = {
        name: 'u.name',
        email: 'u.email',
        created_at: 'u.created_at',
      };
      const sortBy = sortMap[sortByParam] ?? 'u.created_at';

      const whereClauses: string[] = [];
      const params: Array<string | number> = [];

      if (!includeBrokers) {
        whereClauses.push("(b.id IS NULL OR b.status IN ('rejected'))");
      }

      if (searchTerm) {
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ?)');
        params.push(`%${searchTerm}%`, `%${searchTerm}%`);
      }

      const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const [totalRows] = await adminDb.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM users u LEFT JOIN brokers b ON u.id = b.id ${whereSql}`,
        params,
      );
      const total = totalRows[0]?.total ?? 0;

      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            u.id,
            u.name,
            u.email,
            u.phone,
            u.created_at,
            CASE
            WHEN b.id IS NOT NULL AND b.status IN ('approved','pending_verification') THEN 'broker'
              ELSE 'client'
            END AS role
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          ${whereSql}
          ORDER BY ${sortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      return res.json({ data: rows, total });
    } catch (error) {
      console.error('Erro ao listar usuarios:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deleteUser(req: Request, res: Response) {
    const userId = Number(req.params.id);

    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Identificador de usuario invalido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const result = await deleteUserAccount(tx, userId);
      if (!result.affected) {
        await tx.rollback();
        return res.status(404).json({ error: 'Usuario nao encontrado.' });
      }

      await tx.commit();
      return res.status(200).json({ message: 'Usuario deletado com sucesso.' });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao deletar usuario:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async deleteClient(req: Request, res: Response) {
    const clientId = Number(req.params.id);

    if (Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'Identificador de cliente invalido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const snapshot = await loadUserLifecycleSnapshot(tx, clientId, { forUpdate: true });
      if (!snapshot) {
        await tx.rollback();
        return res.status(404).json({ error: 'Cliente nao encontrado.' });
      }
      if (snapshot.broker_id != null && isActiveBrokerStatus(snapshot.broker_status)) {
        await tx.rollback();
        return res.status(400).json({
          error: 'Use a rota de corretores para excluir uma conta ativa de corretor.',
        });
      }

      const result = await deleteUserAccount(tx, clientId);
      if (!result.affected) {
        await tx.rollback();
        return res.status(404).json({ error: 'Cliente nao encontrado.' });
      }

      await tx.commit();
      return res.status(200).json({ message: 'Cliente deletado com sucesso.' });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao deletar cliente:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async deleteBroker(req: Request, res: Response) {
    const brokerId = Number(req.params.id);

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const snapshot = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
      if (!snapshot || snapshot.broker_id == null) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }

      const result = await deleteUserAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }

      await tx.commit();
      return res.status(200).json({ message: 'Corretor deletado com sucesso.' });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao deletar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async deleteProperty(req: Request, res: Response) {
    const { id } = req.params;

    try {
      const [propertyRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT id, video_url FROM properties WHERE id = ?',
        [id]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const [imageRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT image_url FROM property_images WHERE property_id = ?',
        [id]
      );
      const mediaUrls = [
        ...imageRows.map((row) =>
          typeof row.image_url === 'string' ? row.image_url : null
        ),
        typeof propertyRows[0]?.video_url === 'string' ? propertyRows[0].video_url : null,
      ];

      await adminDb.query('DELETE FROM properties WHERE id = ?', [id]);
      await cleanupPropertyMediaAssets(mediaUrls, 'admin_delete_property');
      return res.status(200).json({ message: 'Imovel deletado com sucesso.' });
    } catch (error) {
      console.error('Erro ao deletar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updateProperty(req: Request, res: Response) {
    const { id } = req.params;
    const body = req.body ?? {};

    try {
      const [propertyRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            id,
            status,
            description,
            price,
            price_sale,
            price_rent,
            promotion_price,
            promotional_rent_price,
            purpose,
            title,
            owner_name,
            address,
            numero,
            bairro,
            complemento,
            city,
            quadra,
            sem_quadra,
            lote,
            sem_lote,
            tipo_lote,
            code,
            is_promoted,
            promotion_percentage,
            promotional_rent_percentage
          FROM properties
          WHERE id = ?
        `,
        [id]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel não encontrado.' });
      }

      const property = propertyRows[0];
      const nextDescription = String(body.description ?? property.description ?? '').trim();
      if (!hasValidPropertyDescription(nextDescription)) {
        return res.status(400).json({
          error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
        });
      }

      const nextSemQuadra = Object.prototype.hasOwnProperty.call(body, 'sem_quadra')
        ? parseBoolean(body.sem_quadra)
        : parseBoolean(property.sem_quadra);
      const nextSemLote = Object.prototype.hasOwnProperty.call(body, 'sem_lote')
        ? parseBoolean(body.sem_lote)
        : parseBoolean(property.sem_lote);
      const nextQuadra = nextSemQuadra ? null : stringOrNull(body.quadra ?? property.quadra);
      const nextLote = nextSemLote ? null : stringOrNull(body.lote ?? property.lote);
      if (!nextSemQuadra && !nextQuadra) {
        return res.status(400).json({ error: 'Quadra é obrigatória.' });
      }
      if (!nextSemLote && !nextLote) {
        return res.status(400).json({ error: 'Lote é obrigatório.' });
      }
      const nextTipoLote = stringOrNull(body.tipo_lote ?? property.tipo_lote);
      if (!nextTipoLote) {
        return res.status(400).json({ error: 'Tipo de lote é obrigatório.' });
      }

      const updateTextValidationError = [
        validateMaxTextLength(body.title ?? property.title, 'Título'),
        validateMaxTextLength(body.owner_name ?? property.owner_name, 'Nome do proprietário'),
        validateMaxTextLength(body.address ?? property.address, 'Endereço'),
        validateMaxTextLength(body.numero ?? property.numero, 'Número', 25),
        validateMaxTextLength(body.bairro ?? property.bairro, 'Bairro'),
        validateMaxTextLength(body.complemento ?? property.complemento, 'Complemento'),
        validateMaxTextLength(body.city ?? property.city, 'Cidade'),
        ...(nextSemQuadra ? [] : [validateMaxTextLength(nextQuadra, 'Quadra', 25)]),
        ...(nextSemLote ? [] : [validateMaxTextLength(nextLote, 'Lote', 25)]),
        validateMaxTextLength(nextTipoLote, 'Tipo de lote', 25),
        validateMaxTextLength(body.code ?? property.code, 'Código'),
      ].find(Boolean);

      if (updateTextValidationError) {
        return res.status(400).json({ error: updateTextValidationError });
      }

      const nextPurpose = normalizePurpose(body.purpose) ?? String(property.purpose ?? '');
      const purposeLower = nextPurpose.toLowerCase();
      const supportsSale = purposeLower.includes('vend');
      const supportsRent = purposeLower.includes('alug');
      const previousSalePrice =
        toNullableNumber(property.price_sale) ?? toNullableNumber(property.price);
      const previousRentPrice =
        toNullableNumber(property.price_rent) ??
        (supportsRent && !supportsSale ? toNullableNumber(property.price) : null);
      let nextSalePrice = previousSalePrice;
      let nextRentPrice = previousRentPrice;
      let saleTouched = false;
      let rentTouched = false;
      const previousPromotionFlag = parseBoolean(property.is_promoted);
      let nextPromotionFlag = previousPromotionFlag;
      let nextPromotionPercentage =
        toNullableNumber(property.promotion_percentage);
      let nextPromotionPrice = toNullableNumber(property.promotion_price);
      let nextPromotionalRentPrice = toNullableNumber(property.promotional_rent_price);
      let nextPromotionalRentPercentage = toNullableNumber(
        property.promotional_rent_percentage
      );

      if (Object.prototype.hasOwnProperty.call(body, 'price_sale')) {
        nextSalePrice = parseDecimal(body.price_sale);
        saleTouched = true;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'price_rent')) {
        nextRentPrice = parseDecimal(body.price_rent);
        rentTouched = true;
      }
      if (Object.prototype.hasOwnProperty.call(body, 'price')) {
        const parsed = parseDecimal(body.price);
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
      }

      const nextStatus = normalizeStatus(body.status) ?? (property.status as string);
      const shouldNotifyPriceDrop =
        (nextStatus ?? '').toLowerCase() === 'approved' && (saleTouched || rentTouched);

      const allowedFields = new Set([
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
        'tipo_lote',
        'sem_quadra',
        'sem_lote',
        'city',
        'state',
        'cep',
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
        'sale_value',
        'commission_rate',
        'commission_value',
      ]);

      const setParts: string[] = [];
      const params: any[] = [];

      for (const [key, value] of Object.entries(body)) {
        if (!allowedFields.has(key)) {
          continue;
        }

        switch (key) {
          case 'status': {
            const normalized = normalizeStatus(value);
            if (!normalized) {
              return res.status(400).json({ error: 'Status invalido.' });
            }
            setParts.push('status = ?');
            params.push(normalized);
            break;
          }
          case 'purpose': {
            const normalized = normalizePurpose(value);
            if (!normalized) {
              return res.status(400).json({ error: 'Finalidade invalida.' });
            }
            setParts.push('purpose = ?');
            params.push(normalized);
            break;
          }
          case 'type': {
            const normalized = normalizePropertyType(value);
            if (!normalized) {
              return res.status(400).json({ error: 'Tipo de imóvel inválido.' });
            }
            setParts.push('type = ?');
            params.push(normalized);
            break;
          }
          case 'price':
          case 'price_sale':
          case 'price_rent':
          case 'sale_value':
          case 'commission_rate':
          case 'commission_value':
          case 'area_construida':
          case 'area_terreno':
          case 'valor_condominio':
          case 'valor_iptu': {
            try {
              setParts.push(`${key} = ?`);
              params.push(parseDecimal(value));
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'bedrooms':
          case 'bathrooms':
          case 'garage_spots': {
            try {
              setParts.push(`${key} = ?`);
              params.push(parseInteger(value));
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
          case 'eh_mobiliada':
          case 'sem_numero':
          case 'sem_quadra':
          case 'sem_lote': {
            setParts.push(`${key} = ?`);
            params.push(parseBoolean(value));
            break;
          }
          case 'tipo_lote': {
            setParts.push('tipo_lote = ?');
            params.push(normalizeTipoLote(value));
            break;
          }
          case 'is_promoted': {
            const parsed = parseBoolean(value);
            nextPromotionFlag = parsed;
            if (parsed === 0) {
              nextPromotionPercentage = null;
              nextPromotionPrice = null;
              nextPromotionalRentPrice = null;
              setParts.push('promotion_percentage = ?');
              params.push(null);
              setParts.push('promotion_start = ?');
              params.push(null);
              setParts.push('promotion_end = ?');
              params.push(null);
              setParts.push('promotion_price = ?');
              params.push(null);
              setParts.push('promotional_rent_price = ?');
              params.push(null);
              setParts.push('promotional_rent_percentage = ?');
              params.push(null);
            }
            setParts.push('is_promoted = ?');
            params.push(parsed);
            break;
          }
          case 'promotion_percentage': {
            try {
              const parsed = parsePromotionPercentage(value);
              nextPromotionPercentage = parsed;
              setParts.push('promotion_percentage = ?');
              params.push(parsed);
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
              const parsed = parsePromotionPercentage(value);
              nextPromotionalRentPercentage = parsed;
              setParts.push('promotional_rent_percentage = ?');
              params.push(parsed);
              if (parsed != null) {
                nextPromotionFlag = 1;
              }
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'promotion_price':
          case 'promotional_price':
          case 'promotional_rent_price': {
            try {
              const parsed = parseDecimal(value);
              if (key === 'promotional_rent_price') {
                setParts.push('promotional_rent_price = ?');
                params.push(parsed);
                nextPromotionalRentPrice = parsed;
              } else {
                setParts.push('promotion_price = ?');
                params.push(parsed);
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
          case 'promotion_start':
          case 'promotion_end': {
            try {
              const parsed = parsePromotionDateTime(value);
              setParts.push(`${key} = ?`);
              params.push(parsed);
            } catch (parseError) {
              return res.status(400).json({ error: (parseError as Error).message });
            }
            break;
          }
          case 'owner_phone': {
            const text = String(value ?? '').trim();
            if (text.length === 0) {
              setParts.push('owner_phone = ?');
              params.push(null);
              break;
            }
            if (!hasValidPhone(text)) {
              return res.status(400).json({ error: 'Telefone do proprietário inválido.' });
            }
            setParts.push('owner_phone = ?');
            params.push(normalizePhone(text));
            break;
          }
          case 'owner_id': {
            if (value === undefined || value === null || value === '') {
              setParts.push('owner_id = ?');
              params.push(null);
              break;
            }
            const parsedOwnerId = Number(value);
            if (!Number.isInteger(parsedOwnerId) || parsedOwnerId <= 0) {
              return res.status(400).json({ error: 'owner_id invalido.' });
            }
            setParts.push('owner_id = ?');
            params.push(parsedOwnerId);
            break;
          }
          default: {
            if (value === undefined || !ALLOWED_PROPERTY_TEXT_UPDATE_FIELDS.has(key)) {
              continue;
            }
            setParts.push(`\`${key}\` = ?`);
            params.push(stringOrNull(value));
          }
        }
      }

      const numericValidationError = [
        validatePropertyNumericRange(
          supportsSale && nextSalePrice != null ? nextSalePrice : supportsRent ? nextRentPrice : nextSalePrice,
          'Preço base',
          { max: MAX_PROPERTY_PRICE }
        ),
        validatePropertyNumericRange(nextSalePrice, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(nextRentPrice, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(nextPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(nextPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        Object.prototype.hasOwnProperty.call(body, 'bedrooms')
          ? validatePropertyNumericRange(parseInteger(body.bedrooms), 'Quartos', { max: MAX_PROPERTY_COUNT })
          : null,
        Object.prototype.hasOwnProperty.call(body, 'bathrooms')
          ? validatePropertyNumericRange(parseInteger(body.bathrooms), 'Banheiros', { max: MAX_PROPERTY_COUNT })
          : null,
        Object.prototype.hasOwnProperty.call(body, 'garage_spots')
          ? validatePropertyNumericRange(parseInteger(body.garage_spots), 'Garagens', { max: MAX_PROPERTY_COUNT })
          : null,
        Object.prototype.hasOwnProperty.call(body, 'area_construida')
          ? validatePropertyNumericRange(parseDecimal(body.area_construida), 'Área construída', { max: MAX_PROPERTY_AREA })
          : null,
        Object.prototype.hasOwnProperty.call(body, 'area_terreno')
          ? validatePropertyNumericRange(parseDecimal(body.area_terreno), 'Área do terreno', { max: MAX_PROPERTY_AREA })
          : null,
        Object.prototype.hasOwnProperty.call(body, 'valor_condominio')
          ? validatePropertyNumericRange(parseDecimal(body.valor_condominio), 'Valor de condomínio', { max: MAX_PROPERTY_FEE, allowNull: true })
          : null,
        Object.prototype.hasOwnProperty.call(body, 'valor_iptu')
          ? validatePropertyNumericRange(parseDecimal(body.valor_iptu), 'Valor de IPTU', { max: MAX_PROPERTY_FEE, allowNull: true })
          : null,
      ].find(Boolean);

      if (numericValidationError) {
        return res.status(400).json({ error: numericValidationError });
      }

      if (!supportsSale && Object.prototype.hasOwnProperty.call(body, 'promotion_price')) {
        setParts.push('promotion_price = ?');
        params.push(null);
        nextPromotionPrice = null;
      }
      if (!supportsSale && Object.prototype.hasOwnProperty.call(body, 'promotional_price')) {
        setParts.push('promotion_price = ?');
        params.push(null);
        nextPromotionPrice = null;
      }
      if (!supportsRent && Object.prototype.hasOwnProperty.call(body, 'promotional_rent_price')) {
        setParts.push('promotional_rent_price = ?');
        params.push(null);
        nextPromotionalRentPrice = null;
      }
      if (!supportsRent && Object.prototype.hasOwnProperty.call(body, 'promotional_rent_percentage')) {
        setParts.push('promotional_rent_percentage = ?');
        params.push(null);
        nextPromotionalRentPercentage = null;
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

      const hasAbsolutePromotion =
        nextPromotionPrice != null || nextPromotionalRentPrice != null;
      const hasAnyPromotion =
        hasAbsolutePromotion ||
        nextPromotionPercentage != null ||
        nextPromotionalRentPercentage != null;
      if (hasAnyPromotion && !Object.prototype.hasOwnProperty.call(body, 'is_promoted')) {
        nextPromotionFlag = 1;
        setParts.push('is_promoted = ?');
        params.push(1);
      }

      if (setParts.length === 0) {
        return res.status(400).json({ error: 'Nenhum dado fornecido para atualizacao.' });
      }

      params.push(id);

      await adminDb.query(
        `UPDATE properties SET ${setParts.join(', ')} WHERE id = ?`,
        params
      );

      if (shouldNotifyPriceDrop) {
        try {
          const title =
            typeof body.title === 'string' && body.title.trim()
              ? body.title.trim()
              : String(property.title ?? '');
          await notifyPriceDropIfNeeded({
            propertyId: Number(id),
            propertyTitle: title,
            previousSalePrice,
            newSalePrice: saleTouched ? nextSalePrice : undefined,
            previousRentPrice,
            newRentPrice: rentTouched ? nextRentPrice : undefined,
          });
        } catch (notifyError) {
          console.error('Erro ao notificar queda de preço:', notifyError);
        }
      }

      if (!previousPromotionFlag && nextPromotionFlag === 1) {
        try {
          const title =
            typeof body.title === 'string' && body.title.trim()
              ? body.title.trim()
              : String(property.title ?? '');
          await notifyPromotionStarted({
            propertyId: Number(id),
            propertyTitle: title,
            promotionPercentage: nextPromotionPercentage,
          });
        } catch (notifyError) {
          console.error('Erro ao notificar início de promoção:', notifyError);
        }
      }

      return res.status(200).json({ message: 'Imóvel atualizado com sucesso.' });
    } catch (error) {
      console.error('Erro ao atualizar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async signCloudinaryUpload(req: Request, res: Response) {
    try {
      const requestedType =
        typeof req.body?.resource_type === 'string' ? req.body.resource_type.toLowerCase() : 'image';
      if (requestedType !== 'image' && requestedType !== 'video') {
        return res.status(400).json({ error: 'resource_type inválido. Use image ou video.' });
      }

      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!cloudName || !apiKey || !apiSecret) {
        return res.status(500).json({ error: 'Cloudinary não configurado no servidor.' });
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const folder = requestedType === 'image' ? 'conectimovel/properties/admin' : 'conectimovel/videos';
      const maxFileSize =
        requestedType === 'image' ? DIRECT_UPLOAD_IMAGE_MAX_BYTES : DIRECT_UPLOAD_VIDEO_MAX_BYTES;
      const allowedFormats =
        requestedType === 'image' ? CLOUDINARY_IMAGE_ALLOWED_FORMATS : CLOUDINARY_VIDEO_ALLOWED_FORMATS;
      const paramsToSign: Record<string, string | number> = {
        folder,
        timestamp,
        allowed_formats: allowedFormats.join(','),
      };

      const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
      return res.status(200).json({
        apiKey,
        cloudName,
        signature,
        timestamp,
        folder,
        maxFileSize,
        allowedFormats,
        resourceType: requestedType,
        uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${requestedType}/upload`,
      });
    } catch (error) {
      console.error('Erro ao assinar upload do Cloudinary:', error);
      return res.status(500).json({ error: 'Não foi possível preparar upload direto.' });
    }
  }

  async createProperty(req: Request, res: Response) {
    const files = (req as any).files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const body = req.body ?? {};

    try {
      const required = [
        'title',
        'description',
        'type',
        'purpose',
        'address',
        'bairro',
        'tipo_lote',
        'city',
        'state',
        'bedrooms',
        'bathrooms',
        'area_construida',
        'area_terreno',
        'garage_spots',
      ];
      for (const field of required) {
      if (!body[field]) {
        return res.status(400).json({ error: `Campo obrigatorio ausente: ${field}` });
      }
    }

      if (!hasValidPropertyDescription(body.description)) {
        return res.status(400).json({
          error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
        });
      }

      const {
        title,
        description,
        type,
        purpose,
        status,
        is_promoted,
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
        tipo_lote,
        city,
        state,
        cep,
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
        video_url,
        broker_id,
        sem_quadra,
        sem_lote,
        area_construida_unidade,
      } = body;
      const semNumeroFlag = parseBoolean(sem_numero);
      const semQuadraFlag = parseBoolean(sem_quadra);
      const semLoteFlag = parseBoolean(sem_lote);

      if (!semQuadraFlag && !String(quadra ?? '').trim()) {
        return res.status(400).json({ error: 'Informe a quadra ou marque a opção sem quadra.' });
      }
      if (!semLoteFlag && !String(lote ?? '').trim()) {
        return res.status(400).json({ error: 'Informe o lote ou marque a opção sem lote.' });
      }

      const normalizedType = normalizePropertyType(type);
      if (!normalizedType) {
        return res.status(400).json({ error: 'Tipo de imóvel inválido.' });
      }

      const normalizedStatus = normalizeStatus(status) ?? 'approved';

      const normalizedPurpose = normalizePurpose(purpose);
      if (!normalizedPurpose) {
        return res.status(400).json({ error: 'Finalidade invalida.' });
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
        validateMaxTextLength(tipo_lote, 'Tipo de lote', 25),
        validateMaxTextLength(code, 'Código'),
      ].find(Boolean);

      if (createTextValidationError) {
        return res.status(400).json({ error: createTextValidationError });
      }

      const numericPrice = parseDecimal(price);
      const numericPriceSale = parseDecimal(price_sale);
      const numericPriceRent = parseDecimal(price_rent);

      let resolvedPrice: number | null = null;
      let resolvedPriceSale: number | null = null;
      let resolvedPriceRent: number | null = null;
      let resolvedPromotionPrice: number | null = null;
      let resolvedPromotionalRentPrice: number | null = null;
      let promotionPercentage: number | null = null;
      let promotionalRentPercentage: number | null = null;
      let promotionFlag: 0 | 1 = 0;
      let promotionStart: string | null = null;
      let promotionEnd: string | null = null;

      if (normalizedPurpose === 'Venda') {
        resolvedPriceSale = numericPriceSale ?? numericPrice;
        resolvedPrice = resolvedPriceSale;
      } else if (normalizedPurpose === 'Aluguel') {
        resolvedPriceRent = numericPriceRent ?? numericPrice;
        resolvedPrice = resolvedPriceRent;
      } else {
        resolvedPriceSale = numericPriceSale;
        resolvedPriceRent = numericPriceRent;
        resolvedPrice = resolvedPriceSale;
      }

      if (!resolvedPrice || resolvedPrice <= 0) {
        return res.status(400).json({ error: 'Preco invalido.' });
      }

      if (normalizedPurpose === 'Venda e Aluguel') {
        if (!resolvedPriceSale || resolvedPriceSale <= 0 || !resolvedPriceRent || resolvedPriceRent <= 0) {
          return res.status(400).json({ error: 'Informe os precos de venda e aluguel.' });
        }
      }

      resolvedPromotionPrice = parseDecimal(promotion_price ?? promotional_price);
      resolvedPromotionalRentPrice = parseDecimal(promotional_rent_price);
      try {
        promotionPercentage = parsePromotionPercentage(promotion_percentage);
        promotionalRentPercentage = parsePromotionPercentage(promotional_rent_percentage);
      } catch (parseError) {
        return res.status(400).json({ error: (parseError as Error).message });
      }

      if (normalizedPurpose === 'Venda') {
        resolvedPromotionalRentPrice = null;
        promotionalRentPercentage = null;
      } else if (normalizedPurpose === 'Aluguel') {
        resolvedPromotionPrice = null;
        promotionPercentage = null;
      }

      if (
        resolvedPromotionPrice == null &&
        promotionPercentage != null &&
        resolvedPriceSale != null
      ) {
        resolvedPromotionPrice = Number(
          (resolvedPriceSale * (1 - promotionPercentage / 100)).toFixed(2)
        );
      }

      if (
        resolvedPromotionalRentPrice == null &&
        promotionalRentPercentage != null &&
        resolvedPriceRent != null
      ) {
        resolvedPromotionalRentPrice = Number(
          (resolvedPriceRent * (1 - promotionalRentPercentage / 100)).toFixed(2)
        );
      }

      if (
        resolvedPromotionPrice != null &&
        resolvedPriceSale != null &&
        resolvedPromotionPrice >= resolvedPriceSale
      ) {
        return res.status(400).json({
          error: 'Preço promocional de venda deve ser menor que o preço de venda.',
        });
      }

      if (
        resolvedPromotionalRentPrice != null &&
        resolvedPriceRent != null &&
        resolvedPromotionalRentPrice >= resolvedPriceRent
      ) {
        return res.status(400).json({
          error: 'Preço promocional de aluguel deve ser menor que o preço de aluguel.',
        });
      }

      const numericBedrooms = parseInteger(bedrooms);
      const numericBathrooms = parseInteger(bathrooms);
      const numericGarageSpots = parseInteger(garage_spots);
      const areaUnidade = normalizeAreaUnidade(
        typeof area_construida_unidade === 'string' ? area_construida_unidade : 'm2',
      );
      const rawAreaInput = parseDecimal(area_construida);
      let numericAreaConstruida: number | null = null;
      if (rawAreaInput != null) {
        const converted = areaInputToSquareMeters(rawAreaInput, areaUnidade);
        if (Number.isNaN(converted)) {
          return res.status(400).json({ error: 'Área construída inválida.' });
        }
        numericAreaConstruida = converted;
      }
      const numericAreaTerreno = parseDecimal(area_terreno);
      const numericValorCondominio = parseDecimal(valor_condominio);
      const numericValorIptu = parseDecimal(valor_iptu);
      const numericValidationError = [
        validatePropertyNumericRange(resolvedPrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
        validatePropertyNumericRange(resolvedPriceSale, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(resolvedPriceRent, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(resolvedPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(resolvedPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
        validatePropertyNumericRange(numericBedrooms, 'Quartos', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericBathrooms, 'Banheiros', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericGarageSpots, 'Garagens', { max: MAX_PROPERTY_COUNT }),
        validatePropertyNumericRange(numericAreaConstruida, 'Área construída', { max: MAX_PROPERTY_AREA }),
        validatePropertyNumericRange(numericAreaTerreno, 'Área do terreno', { max: MAX_PROPERTY_AREA }),
        validatePropertyNumericRange(numericValorCondominio, 'Valor de condomínio', { max: MAX_PROPERTY_FEE, allowNull: true }),
        validatePropertyNumericRange(numericValorIptu, 'Valor de IPTU', { max: MAX_PROPERTY_FEE, allowNull: true }),
      ].find(Boolean);

      if (numericValidationError) {
        return res.status(400).json({ error: numericValidationError });
      }
      const brokerIdValue = broker_id ? Number(broker_id) : null;

      const hasWifiFlag = parseBoolean(has_wifi);
      const temPiscinaFlag = parseBoolean(tem_piscina);
      const temEnergiaSolarFlag = parseBoolean(tem_energia_solar);
      const temAutomacaoFlag = parseBoolean(tem_automacao);
      const temArCondicionadoFlag = parseBoolean(tem_ar_condicionado);
      const ehMobiliadaFlag = parseBoolean(eh_mobiliada);
      try {
        promotionFlag = parseBoolean(is_promoted);
        promotionStart = parsePromotionDateTime(promotion_start);
        promotionEnd = parsePromotionDateTime(promotion_end);
        if (
          resolvedPromotionPrice != null ||
          resolvedPromotionalRentPrice != null ||
          promotionPercentage != null ||
          promotionalRentPercentage != null
        ) {
          promotionFlag = 1;
        }
        if (promotionFlag === 0) {
          promotionPercentage = null;
          promotionalRentPercentage = null;
          promotionStart = null;
          promotionEnd = null;
        }
      } catch (parseError) {
        return res.status(400).json({ error: (parseError as Error).message });
      }
      const normalizedTipoLote = normalizeTipoLote(tipo_lote);
      if (!normalizedTipoLote) {
        return res.status(400).json({ error: 'Tipo de lote inválido.' });
      }

      if (owner_phone && String(owner_phone).trim().length > 0 && !hasValidPhone(owner_phone)) {
        return res.status(400).json({ error: 'Telefone do proprietário inválido.' });
      }

      const normalizedNumero = semNumeroFlag === 1 ? null : stringOrNull(numero);

      if (
        numericBedrooms == null ||
        numericBathrooms == null ||
        numericGarageSpots == null ||
        numericAreaConstruida == null ||
        numericAreaTerreno == null
      ) {
        return res.status(400).json({ error: 'Campos numéricos obrigatórios inválidos.' });
      }

      const effectiveQuadra = semQuadraFlag ? null : stringOrNull(quadra);
      const effectiveLote = semLoteFlag ? null : stringOrNull(lote);

      const [duplicateRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT id FROM properties
          WHERE address = ?
            AND COALESCE(quadra, '') = COALESCE(?, '')
            AND COALESCE(lote, '') = COALESCE(?, '')
            AND COALESCE(numero, '') = COALESCE(?, '')
            AND COALESCE(bairro, '') = COALESCE(?, '')
          LIMIT 1
        `,
        [address, effectiveQuadra, effectiveLote, normalizedNumero, bairro ?? null]
      );

      if (duplicateRows.length > 0) {
        return res.status(409).json({ error: 'Imovel ja cadastrado no sistema.' });
      }

      const uploadImages = files?.images ?? [];
      const bodyRecord = body as Record<string, unknown>;
      const providedImageUrls = parseImageUrlsInput(bodyRecord).filter((url) =>
        isAllowedCloudinaryMediaUrl(url, 'conectimovel/properties/admin')
      );
      const uploadedImageUrls =
        uploadImages.length > 0
          ? await uploadImagesWithConcurrency(uploadImages, 'properties/admin')
          : [];
      const imageUrls = Array.from(new Set([...providedImageUrls, ...uploadedImageUrls]));
      if (imageUrls.length < 1) {
        return res.status(400).json({ error: 'Envie pelo menos 1 imagem do imóvel.' });
      }
      if (imageUrls.length > MAX_IMAGES_PER_PROPERTY) {
        return res.status(400).json({ error: `Limite máximo de ${MAX_IMAGES_PER_PROPERTY} imagens por imóvel.` });
      }

      let finalVideoUrl: string | null = null;
      const uploadVideos = files?.video ?? [];
      if (uploadVideos[0]) {
        const uploadedVideo = await uploadToCloudinary(uploadVideos[0], 'videos');
        finalVideoUrl = uploadedVideo.url;
      } else if (video_url && isAllowedCloudinaryMediaUrl(String(video_url), 'conectimovel/videos')) {
        finalVideoUrl = String(video_url);
      }

      const trimmedPropertyCode = String(code ?? '').trim();
      const resolvedPropertyCode =
        trimmedPropertyCode.length > 0 ? trimmedPropertyCode : await allocateNextPropertyCode();

      const [result] = await adminDb.query<ResultSetHeader>(
        `
          INSERT INTO properties (
            broker_id,
            title,
            description,
            type,
            purpose,
            status,
            is_promoted,
            promotion_percentage,
            promotion_start,
            promotion_end,
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
            tipo_lote,
            city,
            state,
            cep,
            bedrooms,
            bathrooms,
            area_construida,
            area_construida_unidade,
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          brokerIdValue,
          title,
          description,
          normalizedType,
          normalizedPurpose,
          normalizedStatus,
          promotionFlag,
          promotionPercentage,
          promotionStart,
          promotionEnd,
            resolvedPrice,
            resolvedPriceSale,
            resolvedPriceRent,
            resolvedPromotionPrice,
            resolvedPromotionalRentPrice,
            promotionalRentPercentage,
            resolvedPropertyCode,
            stringOrNull(owner_name),
            owner_phone ? normalizePhone(owner_phone) : null,
            address,
            effectiveQuadra,
            semQuadraFlag,
            effectiveLote,
            semLoteFlag,
          normalizedNumero,
          stringOrNull(bairro),
          stringOrNull(complemento),
          normalizedTipoLote,
          city,
          state,
          stringOrNull(cep),
          numericBedrooms,
          numericBathrooms,
          numericAreaConstruida,
          areaUnidade,
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
          finalVideoUrl,
        ]
      );

      const propertyId = result.insertId;

      if (imageUrls.length > 0) {
        const values = imageUrls.map((url) => [propertyId, url]);
        await adminDb.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
      }

      if (promotionFlag === 1) {
        try {
          await notifyPromotionStarted({
            propertyId,
            propertyTitle: title,
            promotionPercentage,
          });
        } catch (promotionNotifyError) {
          console.error('Erro ao notificar favoritos sobre promocao (create admin):', promotionNotifyError);
        }
      }

      try {
        await notifyAdmins(
          `Um novo imovel '${title}' foi criado pelo admin.`,
          'property',
          propertyId
        );
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre novo imovel:', notifyError);
      }

      return res.status(201).json({
        message: 'Imovel criado com sucesso!',
        propertyId,
        images: imageUrls,
        video: finalVideoUrl,
        status: normalizedStatus,
      });
    } catch (error) {
      console.error('Erro ao criar imovel pelo admin:', error);
      const knownError = error as { statusCode?: number; message?: string };
      if (knownError?.statusCode === 413) {
        return res.status(413).json({
          error:
            knownError.message ||
            'Arquivo muito grande para upload. Reduza o tamanho do arquivo e tente novamente.',
        });
      }
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async createBroker(req: Request, res: Response) {
    const {
      name,
      email,
      phone,
      creci,
      street,
      number,
      complement,
      bairro,
      city,
      state,
      cep,
      agency_id,
      password,
      status,
    } = req.body ?? {};
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    if (!name || !email || !creci || !password || !phone) {
      return res.status(400).json({ error: 'Nome, email, telefone, senha e CRECI são obrigatórios.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Email inválido.' });
    }
    if (!hasValidPhone(phone)) {
      return res.status(400).json({ error: 'Telefone inválido. Use 11 dígitos com DDD.' });
    }
    if (!hasValidCreci(creci)) {
      return res.status(400).json({
        error: 'CRECI inválido. Use 4 a 8 números com sufixo opcional (ex: 12345678-A).',
      });
    }
    if (!normalizeDigits(number)) {
      return res.status(400).json({ error: 'Número do endereço deve conter apenas dígitos.' });
    }

    if (!files?.creciFront?.[0] || !files?.creciBack?.[0] || !files?.selfie?.[0]) {
      return res.status(400).json({
        error: 'Para cadastrar corretor com documentos, envie frente do CRECI, verso do CRECI e selfie.',
      });
    }
    const hasAnyBrokerDocument = true;

    const addressResult = sanitizeAddressInput({
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
        error: 'Endereco incompleto ou invalido.',
        fields: addressResult.errors,
      });
    }

    const db = await adminDb.getConnection();
    try {
      await db.beginTransaction();

      const [existing] = await db.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      if (existing.length > 0) {
        await db.rollback();
        return res.status(409).json({ error: 'Email ja cadastrado.' });
      }

      let passwordHash: string | null = null;
      if (password) {
        const salt = await bcrypt.genSalt(10);
        passwordHash = await bcrypt.hash(String(password), salt);
      }

      const requestedStatus = normalizeStatus(status);
      const brokerStatus =
        requestedStatus === 'approved' ? 'approved' : 'pending_verification';
      const documentStatus = brokerStatus === 'approved' ? 'approved' : 'pending';

      const [userResult] = await db.query<ResultSetHeader>(
        'INSERT INTO users (name, email, phone, password_hash, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          name,
          email,
          normalizePhone(phone),
          passwordHash,
          addressResult.value.street,
          normalizeDigits(addressResult.value.number),
          addressResult.value.complement,
          addressResult.value.bairro,
          addressResult.value.city,
          addressResult.value.state,
          addressResult.value.cep,
        ]
      );
      const userId = userResult.insertId;

      await db.query(
        'INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, ?, ?)',
        [userId, normalizeCreci(creci), brokerStatus, agency_id ? Number(agency_id) : null]
      );

      if (hasAnyBrokerDocument) {
        const creciFrontResult = await uploadToCloudinary(
          files!.creciFront[0],
          'brokers/documents'
        );
        const creciBackResult = await uploadToCloudinary(
          files!.creciBack[0],
          'brokers/documents'
        );
        const selfieResult = await uploadToCloudinary(
          files!.selfie[0],
          'brokers/documents'
        );

        await db.query(
          `INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             creci_front_url = VALUES(creci_front_url),
             creci_back_url = VALUES(creci_back_url),
             selfie_url = VALUES(selfie_url),
             status = VALUES(status),
             updated_at = CURRENT_TIMESTAMP`,
          [userId, creciFrontResult.url, creciBackResult.url, selfieResult.url, documentStatus]
        );
      }

      await db.commit();

      try {
        await notifyAdmins(`Novo corretor '${name}' cadastrado com status '${brokerStatus}'.`, 'broker', userId);
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre novo corretor:', notifyError);
      }

      return res.status(201).json({ message: 'Corretor criado com sucesso.', broker_id: userId });
    } catch (error) {
      await db.rollback();
      console.error('Erro ao criar corretor:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    } finally {
      db.release();
    }
  }

  async createUser(req: Request, res: Response) {
    const { name, email, phone, password, street, number, complement, bairro, city, state, cep } = req.body ?? {};

    if (!name || !email || !phone || !password) {
      return res.status(400).json({ error: 'Nome, email, telefone e senha são obrigatórios.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Email inválido.' });
    }
    if (!hasValidPhone(phone)) {
      return res.status(400).json({ error: 'Telefone inválido. Use 11 dígitos com DDD.' });
    }
    if (!normalizeDigits(number)) {
      return res.status(400).json({ error: 'Número do endereço deve conter apenas dígitos.' });
    }

    const addressResult = sanitizeAddressInput({
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
        error: 'Endereco incompleto ou invalido.',
        fields: addressResult.errors,
      });
    }

    try {
      const [existing] = await adminDb.query<RowDataPacket[]>(
        'SELECT id FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      if (existing.length > 0) {
        return res.status(409).json({ error: 'Email ja cadastrado.' });
      }

      let passwordHash: string | null = null;
      if (password) {
        const salt = await bcrypt.genSalt(10);
        passwordHash = await bcrypt.hash(String(password), salt);
      }

      const [userResult] = await adminDb.query<ResultSetHeader>(
        'INSERT INTO users (name, email, phone, password_hash, street, number, complement, bairro, city, state, cep) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          name,
          email,
          normalizePhone(phone),
          passwordHash,
          addressResult.value.street,
          normalizeDigits(addressResult.value.number),
          addressResult.value.complement,
          addressResult.value.bairro,
          addressResult.value.city,
          addressResult.value.state,
          addressResult.value.cep,
        ]
      );

      return res.status(201).json({ message: 'Usuario criado com sucesso.', user_id: userResult.insertId });
    } catch (error) {
      console.error('Erro ao criar usuario:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }


  async listPendingBrokers(req: Request, res: Response) {
    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            bd.creci_front_url,
            bd.creci_back_url,
            bd.selfie_url,
            bd.status AS document_status,
            b.created_at
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
          WHERE b.status = 'pending_verification'
            AND (bd.status = 'pending' OR bd.status IS NULL)
        `
      );

      return res.status(200).json({ data: rows });
    } catch (error) {
      console.error('Erro ao buscar corretores pendentes:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async getAllClients(req: Request, res: Response) {
    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.phone, u.created_at
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE b.id IS NULL OR b.status = 'rejected'
        `
      );

      return res.status(200).json({ data: rows, total: rows.length });
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async getClientById(req: Request, res: Response) {
    const clientId = Number(req.params.id);

    if (Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'Identificador de cliente invalido.' });
    }

    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            u.id,
            u.name,
            u.email,
            u.phone,
            u.street,
            u.number,
            u.complement,
            u.bairro,
            u.city,
            u.state,
            u.cep,
            u.created_at
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE u.id = ? AND (b.id IS NULL OR b.status = 'rejected')
          LIMIT 1
        `,
        [clientId],
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Cliente nao encontrado.' });
      }

      return res.status(200).json({ data: rows[0] });
    } catch (error) {
      console.error('Erro ao buscar cliente:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async promoteClientToBroker(req: Request, res: Response) {
    const clientId = Number(req.params.id);
    const { creci } = req.body ?? {};

    if (Number.isNaN(clientId) || clientId <= 0) {
      return res.status(400).json({ error: 'Identificador de cliente invalido.' });
    }
    if (creci == null || String(creci).trim() === '') {
      return res.status(400).json({ error: 'CRECI e obrigatorio.' });
    }
    if (!hasValidCreci(creci)) {
      return res.status(400).json({
        error: 'CRECI inválido. Use 4 a 8 números com sufixo opcional (ex: 12345678-A).',
      });
    }

    const normalizedCreci = normalizeCreci(creci);
    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();

      const [dupCreci] = await tx.query<RowDataPacket[]>(
        'SELECT id FROM brokers WHERE creci = ? AND id <> ? LIMIT 1',
        [normalizedCreci, clientId],
      );
      if (dupCreci.length > 0) {
        await tx.rollback();
        return res.status(409).json({ error: 'CRECI ja vinculado a outro corretor.' });
      }

      const snapshot = await loadUserLifecycleSnapshot(tx, clientId, { forUpdate: true });
      if (!snapshot) {
        await tx.rollback();
        return res.status(404).json({ error: 'Usuario nao encontrado.' });
      }

      if (snapshot.broker_id != null && isActiveBrokerStatus(snapshot.broker_status)) {
        await tx.rollback();
        return res.status(400).json({ error: 'Usuario ja e corretor ativo. Use a gestao de corretores.' });
      }

      if (snapshot.broker_id != null) {
        await promoteBrokerRecordWithLegacyUpdatedAtFallback(tx, clientId, normalizedCreci);
      } else {
        await tx.query(
          `INSERT INTO brokers (id, creci, status, agency_id) VALUES (?, ?, 'approved', NULL)`,
          [clientId, normalizedCreci],
        );
      }

      await tx.commit();

      await notifyBrokerApprovedChange(clientId);
      return res.status(200).json({
        message: 'Usuario promovido a corretor com sucesso.',
        role: 'broker',
        status: 'approved',
        creci: normalizedCreci,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao promover cliente a corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async approveBroker(req: Request, res: Response) {
    const brokerId = Number(req.params.id);

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();
      const result = await approveBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }
      await tx.commit();

      await notifyBrokerApprovedChange(brokerId);
      return res.status(200).json({
        message: 'Corretor aprovado com sucesso.',
        status: 'approved',
        role: 'broker',
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao aprovar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async rejectBroker(req: Request, res: Response) {
    const brokerId = Number(req.params.id);

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();
      const result = await rejectBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }
      await tx.commit();

      await notifyBrokerRejectedChange(brokerId);
      return res.status(200).json({
        message: 'Corretor rejeitado com sucesso.',
        status: 'rejected',
        role: 'client',
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao rejeitar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async cleanupBroker(req: Request, res: Response) {
    const brokerId = Number(req.params.id);

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    const tx = await adminDb.getConnection();
    try {
      await tx.beginTransaction();
      const result = await rejectBrokerAccount(tx, brokerId);
      if (!result.affected) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }
      await tx.commit();

      await notifyBrokerRejectedChange(brokerId);
      return res.status(200).json({
        message: 'Corretor rebaixado para cliente com sucesso.',
        status: 'rejected',
        role: 'client',
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao limpar corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async updateBrokerStatus(req: Request, res: Response) {
    const brokerId = Number(req.params.id);
    const { status } = req.body ?? {};

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor inválido.' });
    }

    if (typeof status !== 'string') {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const normalizedStatus = status.trim();
    const allowedStatuses = new Set(['pending_verification', 'approved', 'rejected']);

    if (!allowedStatuses.has(normalizedStatus)) {
      return res.status(400).json({ error: 'Status de corretor não suportado.' });
    }

    const tx = await adminDb.getConnection();
    let committed = false;
    let role: 'broker' | 'client' = 'client';
    try {
      await tx.beginTransaction();

      const snapshot = await loadUserLifecycleSnapshot(tx, brokerId, { forUpdate: true });
      if (!snapshot || snapshot.broker_id == null) {
        await tx.rollback();
        return res.status(404).json({ error: 'Corretor não encontrado.' });
      }

      role = isActiveBrokerStatus(snapshot.broker_status) ? 'broker' : 'client';

      if (normalizedStatus === 'approved') {
        const result = await approveBrokerAccount(tx, brokerId);
        if (!result.affected) {
          await tx.rollback();
          return res.status(404).json({ error: 'Corretor não encontrado.' });
        }
        role = 'broker';
      } else if (normalizedStatus === 'rejected') {
        const result = await rejectBrokerAccount(tx, brokerId);
        if (!result.affected) {
          await tx.rollback();
          return res.status(404).json({ error: 'Corretor não encontrado.' });
        }
        role = 'client';
      } else {
        await updateBrokerRecordWithLegacyUpdatedAtFallback(tx, brokerId, normalizedStatus);
        role = 'broker';
      }

      await tx.commit();
      committed = true;

      if (normalizedStatus === 'approved') {
        await notifyBrokerApprovedChange(brokerId);
      } else if (normalizedStatus === 'rejected') {
        await notifyBrokerRejectedChange(brokerId);
      } else {
        try {
          await notifyAdmins(
            `Status do corretor #${brokerId} atualizado para ${normalizedStatus}.`,
            'broker',
            brokerId,
          );
        } catch (notifyError) {
          console.error('Erro ao notificar admins sobre status do corretor:', notifyError);
        }
      }

      return res.status(200).json({
        message: 'Status do corretor atualizado com sucesso.',
        status: normalizedStatus,
        role,
      });
    } catch (error) {
      if (!committed) {
        try {
          await tx.rollback();
        } catch (rollbackError) {
          console.error('Erro ao reverter transação (status corretor):', rollbackError);
        }
      }
      console.error('Erro ao atualizar status do corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    } finally {
      tx.release();
    }
  }

  async listBrokers(req: Request, res: Response) {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '10'), 10) || 10, 1), 100);
      const offset = (page - 1) * limit;

      const requestedStatusRaw = String(req.query.status ?? '').trim();
      const requestedStatus = requestedStatusRaw.length == 0 ? 'approved' : requestedStatusRaw;
      const searchTerm = String(req.query.search ?? '').trim();
      const allowedStatuses = new Set(['pending_verification', 'approved', 'rejected', 'all']);
      const whereClauses: string[] = [];
      const params: Array<string | number> = [];

      if (requestedStatus && allowedStatuses.has(requestedStatus)) {
        if (requestedStatus != 'all') {
          whereClauses.push('b.status = ?');
          params.push(requestedStatus);
        }
      } else if (requestedStatusRaw.length > 0) {
        return res.status(400).json({ error: 'Status de corretor inválido.' });
      }

      if (searchTerm) {
        whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR b.creci LIKE ?)');
        params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
      }

      const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

      const sortMap: Record<string, string> = {
        name: 'u.name',
        property_count: 'property_count',
        created_at: 'b.created_at',
        status: 'b.status',
        creci: 'b.creci',
      };
      const sortByParam = String(req.query.sortBy ?? '').toLowerCase();
      const sortBy = sortMap[sortByParam] ?? 'b.created_at';
      const sortOrder = String(req.query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const [totalRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(DISTINCT b.id) AS total
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          ${where}
        `,
        params,
      );
      const total = totalRows[0]?.total ?? 0;

      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            b.created_at,
            a.id AS agency_id,
            a.name AS agency_name,
            a.logo_url AS agency_logo_url,
            a.address AS agency_address,
            a.city AS agency_city,
            a.state AS agency_state,
            a.phone AS agency_phone,
            a.email AS agency_email,
            bd.creci_front_url,
            bd.creci_back_url,
            bd.selfie_url,
            COUNT(p.id) AS property_count
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          LEFT JOIN agencies a ON b.agency_id = a.id
          LEFT JOIN broker_documents bd ON bd.broker_id = b.id
          LEFT JOIN properties p ON p.broker_id = b.id
          ${where}
          GROUP BY
            b.id,
            u.name,
            u.email,
            u.phone,
            b.creci,
            b.status,
            b.created_at,
            a.id,
            a.name,
            a.logo_url,
            a.address,
            a.city,
            a.state,
            a.phone,
            a.email,
            bd.creci_front_url,
            bd.creci_back_url,
            bd.selfie_url
          ORDER BY ${sortBy} ${sortOrder}
          LIMIT ? OFFSET ?
        `,
        [...params, limit, offset]
      );

      const mappedRows = (rows as any[]).map((row) => ({
        ...row,
        documents: {
          creci_front_url: row.creci_front_url ?? null,
          creci_back_url: row.creci_back_url ?? null,
          selfie_url: row.selfie_url ?? null,
        },
      }));

      return res.json({ data: mappedRows, total });
    } catch (error) {
      console.error('Erro ao buscar corretores:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getBrokerById(req: Request, res: Response) {
    const brokerId = Number(req.params.id);

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    try {
      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            b.id,
            u.name,
            u.email,
            u.phone,
            u.street,
            u.number,
            u.complement,
            u.bairro,
            u.city,
            u.state,
            u.cep,
            u.created_at,
            b.creci,
            b.status,
            b.agency_id
          FROM brokers b
          INNER JOIN users u ON b.id = u.id
          WHERE b.id = ?
          LIMIT 1
        `,
        [brokerId],
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Corretor nao encontrado.' });
      }

      return res.status(200).json({ data: rows[0] });
    } catch (error) {
      console.error('Erro ao buscar corretor:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async getPropertyDetails(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel inválido.' });
    }

    try {
      const [rows] = await adminDb.query<PropertyDetailRow[]>(
        `
          SELECT
            p.*,
            ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
            ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
            ANY_VALUE(b.status) AS broker_status,
            ANY_VALUE(b.creci) AS broker_creci
          FROM properties p
          LEFT JOIN brokers b ON p.broker_id = b.id
          LEFT JOIN users u ON u.id = b.id
          LEFT JOIN users u_owner ON u_owner.id = p.owner_id
          WHERE p.id = ?
          GROUP BY p.id
        `,
        [propertyId],
      );

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      const property = rows[0];
      const [imageRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT id, image_url
          FROM property_images
          WHERE property_id = ?
          ORDER BY id ASC
        `,
        [propertyId]
      );
      property.images = imageRows
        .map((row) => {
          const imageId = Number(row.id);
          const imageUrl = typeof row.image_url === 'string' ? row.image_url.trim() : '';
          if (!Number.isFinite(imageId) || imageUrl.length === 0) {
            return null;
          }
          return `${imageId}|${imageUrl}`;
        })
        .filter((item): item is string => Boolean(item));

      return res.status(200).json(mapAdminProperty(property));
    } catch (error) {
      console.error('Erro ao buscar detalhes do imóvel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async approveProperty(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel inválido.' });
    }

    try {
      const [result] = await adminDb.query<ResultSetHeader>('UPDATE properties SET status = ? WHERE id = ?', [
        'approved',
        propertyId,
      ]);

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imovel não encontrado.' });
      }

      try {
        await notifyAdmins(`Imovel #${propertyId} aprovado pelo admin.`, 'property', propertyId);
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre aprovação de imovel:', notifyError);
      }
      try {
        const { ownerId, title } = await fetchPropertyOwner(propertyId);
        if (ownerId) {
          const propertyLabel =
            title && title.trim().length > 0 ? title.trim() : 'sem titulo';
          const role = await resolveUserNotificationRole(ownerId);
          await notifyUsers({
            message: `Seu imovel "${propertyLabel}" foi aprovado e ja esta disponivel no app.`,
            recipientIds: [ownerId],
            recipientRole: role,
            relatedEntityType: 'property',
            relatedEntityId: propertyId,
          });
        }
      } catch (notifyError) {
        console.error('Erro ao notificar usuario sobre aprovacao do imovel:', notifyError);
      }

      return res.status(200).json({ message: 'Imóvel aprovado com sucesso.' });
    } catch (error) {
      console.error('Erro ao aprovar imóvel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async rejectProperty(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const { ownerId, title } = await fetchPropertyOwner(propertyId);
      if (!ownerId && !title) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const [result] = await adminDb.query<ResultSetHeader>(
        'DELETE FROM properties WHERE id = ?',
        [propertyId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const propertyLabel =
        title && title.trim().length > 0 ? title.trim() : 'sem titulo';

      try {
        await notifyAdmins(
          `Imovel #${propertyId} rejeitado e removido pelo admin.`,
          'property',
          propertyId,
        );
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre rejeicao de imovel:', notifyError);
      }
      try {
        if (ownerId) {
          const role = await resolveUserNotificationRole(ownerId);
          await notifyUsers({
            message: `Seu imovel "${propertyLabel}" foi rejeitado e removido. Voce pode cadastrar novamente com as informacoes corrigidas.`,
            recipientIds: [ownerId],
            recipientRole: role,
            relatedEntityType: 'property',
            relatedEntityId: propertyId,
          });
        }
      } catch (notifyError) {
        console.error('Erro ao notificar usuario sobre rejeicao do imovel:', notifyError);
      }

      return res.status(200).json({ message: 'Imóvel rejeitado e removido com sucesso.' });
    } catch (error) {
      console.error('Erro ao rejeitar imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async updatePropertyStatus(req: Request, res: Response) {
    const propertyId = Number(req.params.id);
    const { status } = req.body ?? {};

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imóvel invalido.' });
    }

    if (typeof status !== 'string') {
      return res.status(400).json({ error: 'Status inválido.' });
    }

    const normalizedStatus = status.trim();
    const allowedStatuses = new Set(['pending_approval', 'approved', 'rejected', 'rented', 'sold']);

    if (!allowedStatuses.has(normalizedStatus)) {
      return res.status(400).json({ error: 'Status de imóvel nao suportado.' });
    }

    if (normalizedStatus === 'rejected') {
      return this.rejectProperty(req, res);
    }

    try {
      const [result] = await adminDb.query<ResultSetHeader>(
        'UPDATE properties SET status = ? WHERE id = ?',
        [normalizedStatus, propertyId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      try {
        await notifyAdmins(`Status do imovel #${propertyId} atualizado para ${normalizedStatus}.`, 'property', propertyId);
      } catch (notifyError) {
        console.error('Erro ao notificar admins sobre status de imovel:', notifyError);
      }
      if (normalizedStatus === 'approved' || normalizedStatus === 'rejected') {
        try {
          const { ownerId, title } = await fetchPropertyOwner(propertyId);
          if (ownerId) {
            const propertyLabel =
              title && title.trim().length > 0 ? title.trim() : 'sem titulo';
            const message =
              normalizedStatus === 'approved'
                ? `Seu imovel "${propertyLabel}" foi aprovado e ja esta disponivel no app.`
                : `Seu imovel "${propertyLabel}" foi rejeitado. Revise as informacoes e tente novamente.`;
            const role = await resolveUserNotificationRole(ownerId);
            await notifyUsers({
              message,
              recipientIds: [ownerId],
              recipientRole: role,
              relatedEntityType: 'property',
              relatedEntityId: propertyId,
            });
          }
        } catch (notifyError) {
          console.error('Erro ao notificar usuario sobre status do imovel:', notifyError);
        }
      }

      return res.status(200).json({
        message: 'Status do imovel atualizado com sucesso.',
        status: normalizedStatus,
      });
    } catch (error) {
      console.error('Erro ao atualizar status do imovel:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async addPropertyImage(req: Request, res: Response) {
    const propertyId = Number(req.params.id);
    const files = req.files as Express.Multer.File[] | undefined;

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Nenhuma imagem enviada.' });
    }

    try {
      const [propertyRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT id FROM properties WHERE id = ?',
        [propertyId]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const [imageCountRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM property_images WHERE property_id = ?',
        [propertyId]
      );
      const existingCount = Number(imageCountRows[0]?.total ?? 0);
      const availableSlots = Math.max(0, MAX_IMAGES_PER_PROPERTY - existingCount);

      if (availableSlots <= 0) {
        return res.status(400).json({
          error: `Limite maximo de ${MAX_IMAGES_PER_PROPERTY} imagens por imovel atingido.`,
        });
      }

      if (files.length > availableSlots) {
        return res.status(400).json({
          error: `Este imovel aceita somente ${availableSlots} nova(s) imagem(ns).`,
        });
      }

      const uploadedUrls = await uploadImagesWithConcurrency(files, 'properties/admin');

      if (uploadedUrls.length > 0) {
        const values = uploadedUrls.map((url) => [propertyId, url]);
        await adminDb.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
      }

      return res.status(201).json({ message: 'Imagens adicionadas com sucesso.', images: uploadedUrls });
    } catch (error) {
      console.error('Erro ao adicionar imagens:', error);
      const knownError = error as { statusCode?: number; message?: string } | null;
      if (knownError?.statusCode === 413) {
        return res.status(413).json({
          error: 'Arquivo muito grande. Reduza o tamanho da imagem e tente novamente.',
        });
      }
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deletePropertyImage(req: Request, res: Response) {
    const propertyId = Number(req.params.id);
    const imageId = Number(req.params.imageId);

    if (Number.isNaN(propertyId) || Number.isNaN(imageId)) {
      return res.status(400).json({ error: 'Identificadores invalidos.' });
    }

    try {
      const [imageRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT image_url FROM property_images WHERE id = ? AND property_id = ?',
        [imageId, propertyId]
      );
      const imageUrl =
        typeof imageRows[0]?.image_url === 'string' ? imageRows[0].image_url : null;

      const [imageCountRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT COUNT(*) AS total FROM property_images WHERE property_id = ?',
        [propertyId]
      );
      const totalImages = Number(imageCountRows[0]?.total ?? 0);
      if (totalImages <= 1) {
        return res.status(400).json({ error: 'O imóvel precisa manter ao menos 1 imagem.' });
      }

      const [result] = await adminDb.query<ResultSetHeader>(
        'DELETE FROM property_images WHERE id = ? AND property_id = ?',
        [imageId, propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imagem nao encontrada para este imovel.' });
      }

      await cleanupPropertyMediaAssets([imageUrl], 'admin_delete_property_image');
      return res.status(200).json({ message: 'Imagem removida com sucesso.' });
    } catch (error) {
      console.error('Erro ao remover imagem:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async addPropertyVideo(req: Request, res: Response) {
    const propertyId = Number(req.params.id);
    const file = (req as any).file as Express.Multer.File | undefined;

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    if (!file) {
      return res.status(400).json({ error: 'Nenhum video enviado.' });
    }

    try {
      const [propertyRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT id, video_url FROM properties WHERE id = ?',
        [propertyId]
      );

      if (propertyRows.length === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      const previousVideoUrl =
        typeof propertyRows[0]?.video_url === 'string' ? propertyRows[0].video_url : null;
      const uploaded = await uploadToCloudinary(file, 'videos');
      await adminDb.query('UPDATE properties SET video_url = ? WHERE id = ?', [uploaded.url, propertyId]);
      await cleanupPropertyMediaAssets([previousVideoUrl], 'admin_replace_property_video');

      return res.status(201).json({ message: 'Video adicionado com sucesso.', video: uploaded.url });
    } catch (error) {
      console.error('Erro ao adicionar video:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deletePropertyVideo(req: Request, res: Response) {
    const propertyId = Number(req.params.id);

    if (Number.isNaN(propertyId)) {
      return res.status(400).json({ error: 'Identificador de imovel invalido.' });
    }

    try {
      const [propertyRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT video_url FROM properties WHERE id = ?',
        [propertyId]
      );
      const videoUrl =
        typeof propertyRows[0]?.video_url === 'string' ? propertyRows[0].video_url : null;

      const [result] = await adminDb.query<ResultSetHeader>(
        'UPDATE properties SET video_url = NULL WHERE id = ?',
        [propertyId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }

      await cleanupPropertyMediaAssets([videoUrl], 'admin_delete_property_video');
      return res.status(200).json({ message: 'Video removido com sucesso.' });
    } catch (error) {
      console.error('Erro ao remover video:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getBrokerProperties(req: Request, res: Response) {
    const brokerId = Number(req.params.id);

    if (Number.isNaN(brokerId)) {
      return res.status(400).json({ error: 'Identificador de corretor invalido.' });
    }

    try {
      const [properties] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            p.id,
            p.title,
            p.status,
            p.type,
            p.purpose,
            p.price,
            p.price_sale,
            p.price_rent,
            p.promotion_price,
            p.promotional_rent_price,
            p.promotional_rent_percentage,
            p.address,
            p.city,
            p.state,
            p.created_at
          FROM properties p
          WHERE p.broker_id = ?
          ORDER BY p.created_at DESC
        `,
        [brokerId]
      );

      return res.status(200).json({ data: properties });
    } catch (error) {
      console.error('Erro ao buscar imoveis do corretor:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getClientProperties(req: Request, res: Response) {
    const clientId = Number(req.params.id);

    if (Number.isNaN(clientId)) {
      return res.status(400).json({ error: 'Identificador de cliente invalido.' });
    }

    try {
      const [properties] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            p.id,
            p.title,
            p.status,
            p.type,
            p.purpose,
            p.price,
            p.price_sale,
            p.price_rent,
            p.promotion_price,
            p.promotional_rent_price,
            p.promotional_rent_percentage,
            p.address,
            p.city,
            p.state,
            p.created_at
          FROM properties p
          WHERE p.owner_id = ?
          ORDER BY p.created_at DESC
        `,
        [clientId]
      );

      return res.status(200).json({ data: properties });
    } catch (error) {
      console.error('Erro ao buscar imoveis do cliente:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async getNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
      const offset = (page - 1) * limit;
      const rawType = String(req.query.type ?? '').trim();
      const allowedTypes = new Set([
        'property',
        'broker',
        'agency',
        'user',
        'announcement',
        'negotiation',
        'other',
      ]);
      const typeFilter = allowedTypes.has(rawType) ? rawType : null;
      const baseParams: Array<number | string> = [adminId];
      let typeClause = '';
      if (typeFilter) {
        typeClause = ' AND related_entity_type = ?';
        baseParams.push(typeFilter);
      }
      const [rows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT
            id,
            title,
            message,
            related_entity_type,
            related_entity_id,
            metadata_json,
            is_read,
            created_at
          FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'admin'
            ${typeClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
        ,
        [...baseParams, limit, offset]
      );
      const [countRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) as total
          FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'admin'
            ${typeClause}
        `,
        baseParams,
      );
      const total = countRows.length > 0 ? Number(countRows[0].total) : 0;

      return res.status(200).json({ data: rows, total, page, limit });
    } catch (error) {
      console.error('Erro ao buscar notificacoes:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async deleteNotification(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);
    const notificationId = Number(req.params.id);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    if (Number.isNaN(notificationId)) {
      return res.status(400).json({ error: 'Identificador de notificacao invalido.' });
    }

    try {
      const [result] = await adminDb.query<ResultSetHeader>(
        "DELETE FROM notifications WHERE id = ? AND recipient_id = ? AND recipient_type = 'admin'",
        [notificationId, adminId],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Notificacao nao encontrada.' });
      }

      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao deletar notificacao:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async clearNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      await adminDb.query("DELETE FROM notifications WHERE recipient_id = ? AND recipient_type = 'admin'", [adminId]);
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao limpar notificacoes:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }

  async clearAnnouncementNotifications(req: AuthRequest, res: Response) {
    const adminId = Number(req.userId);

    if (!adminId) {
      return res.status(401).json({ error: 'Administrador nao autenticado.' });
    }

    try {
      await adminDb.query(
        `
          DELETE FROM notifications
          WHERE recipient_id = ?
            AND recipient_type = 'admin'
            AND related_entity_type = 'announcement'
        `,
        [adminId]
      );
      return res.status(204).send();
    } catch (error) {
      console.error('Erro ao limpar avisos:', error);
      return res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
    }
  }
}


/**
 * Busca estatisticas agregadas para o dashboard do admin.
 */
export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const propertiesByStatusQuery = `
      SELECT
        status,
        COUNT(*) AS count
      FROM properties
      GROUP BY status
    `;

    const newPropertiesQuery = `
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS count
      FROM properties
      WHERE created_at >= CURDATE() - INTERVAL 30 DAY
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    const totalsQuery = `
      SELECT
        (SELECT COUNT(*) FROM properties) AS totalProperties,
        (SELECT COUNT(*) FROM brokers) AS totalBrokers,
        (SELECT COUNT(*) FROM users) AS totalUsers
    `;

    const [propertiesByStatusResult, newPropertiesResult, totalsResult] = await Promise.all([
      adminDb.query<RowDataPacket[]>(propertiesByStatusQuery),
      adminDb.query<RowDataPacket[]>(newPropertiesQuery),
      adminDb.query<RowDataPacket[]>(totalsQuery),
    ]);

    const [propertiesByStatusRows] = propertiesByStatusResult;
    const [newPropertiesRows] = newPropertiesResult;
    const [totalsRow] = totalsResult;
    const totals = Array.isArray(totalsRow) && totalsRow[0] ? totalsRow[0] : null;

    return res.status(200).json({
      totalProperties: Number(totals?.totalProperties ?? 0),
      totalBrokers: Number(totals?.totalBrokers ?? 0),
      totalUsers: Number(totals?.totalUsers ?? 0),
      propertiesByStatus: propertiesByStatusRows ?? [],
      newPropertiesOverTime: newPropertiesRows ?? [],
    });
  } catch (error) {
    console.error('Erro ao buscar estatisticas do dashboard:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
};


export async function sendNotification(req: Request, res: Response) {
  try {
    const {
      message,
      recipientId,
      recipientIds,
      related_entity_type,
      related_entity_id,
      audience,
    } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'A mensagem e obrigatoria.' });
    }

    const trimmedMessage = message.trim();
    const allowedTypes = new Set(['property', 'broker', 'agency', 'user', 'announcement', 'negotiation', 'other']);
    const rawEntityType = String(related_entity_type);
    const entityType = (allowedTypes.has(rawEntityType) ? rawEntityType : 'other') as
      | 'property'
      | 'broker'
      | 'agency'
      | 'user'
      | 'announcement'
      | 'negotiation'
      | 'other';
    const entityId = related_entity_id != null ? Number(related_entity_id) : null;

    const audienceValue = typeof audience === 'string' ? audience.trim().toLowerCase() : 'all';
    const normalizedAudience =
      audienceValue === 'client' ||
      audienceValue === 'broker' ||
      audienceValue === 'favorites'
        ? audienceValue
        : 'all';

    const normalizedRecipients: Array<number | null> = [];
    if (Array.isArray(recipientIds)) {
      for (const rid of recipientIds) {
        const parsed = rid === null || rid === 'all' ? null : Number(rid);
        if (parsed === null || Number.isFinite(parsed)) {
          normalizedRecipients.push(parsed === null ? null : Number(parsed));
        }
      }
    } else if (recipientId !== undefined) {
      const parsed = recipientId === null || recipientId === 'all' ? null : Number(recipientId);
      if (parsed === null || Number.isFinite(parsed)) {
        normalizedRecipients.push(parsed === null ? null : Number(parsed));
      }
    }

    if (normalizedRecipients.length === 0) {
      normalizedRecipients.push(null);
    }

    const sendToAll = normalizedRecipients.some((rid) => rid === null);
    let notificationRecipients: number[] = [];

    const numericEntityId = entityId != null && Number.isFinite(entityId) ? Number(entityId) : null;
    if (normalizedAudience === 'favorites') {
      if (entityType !== 'property' || numericEntityId == null) {
        return res.status(400).json({
          error:
            "Para público 'favoritos', informe related_entity_type='property' e related_entity_id válido.",
        });
      }

      const [favoriteRows] = await adminDb.query<RowDataPacket[]>(
        'SELECT DISTINCT usuario_id FROM favoritos WHERE imovel_id = ?',
        [numericEntityId]
      );
      const favoriteIds = (favoriteRows ?? [])
        .map((row) => Number(row.usuario_id))
        .filter((id) => Number.isFinite(id));
      const favoriteIdSet = new Set(favoriteIds);

      if (sendToAll) {
        notificationRecipients = favoriteIds;
      } else {
        notificationRecipients = normalizedRecipients
          .filter((rid): rid is number => typeof rid === 'number')
          .filter((rid) => favoriteIdSet.has(rid));
      }
    } else if (sendToAll) {
      if (normalizedAudience === 'broker') {
        const [userRows] = await adminDb.query<RowDataPacket[]>(
          "SELECT id FROM brokers WHERE status IN ('pending_verification','approved')",
        );
        notificationRecipients = (userRows ?? [])
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id));
      } else if (normalizedAudience === 'client') {
        const [userRows] = await adminDb.query<RowDataPacket[]>(
          `
            SELECT u.id
            FROM users u
            LEFT JOIN brokers b ON u.id = b.id
            WHERE b.id IS NULL OR b.status IN ('rejected')
          `
        );
        notificationRecipients = (userRows ?? [])
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id));
      } else {
        const [userRows] = await adminDb.query<RowDataPacket[]>(
          'SELECT id FROM users'
        );
        notificationRecipients = (userRows ?? [])
          .map((row) => Number(row.id))
          .filter((id) => Number.isFinite(id));
      }
    } else {
      notificationRecipients = normalizedRecipients.filter(
        (rid): rid is number => typeof rid === 'number'
      );
    }

    if (notificationRecipients.length === 0) {
      return res.status(200).json({
        message: 'Nenhum destinatário encontrado para envio.',
        push: { requested: 0, success: 0, failure: 0, errorCodes: [] },
      });
    }

    const { clientIds, brokerIds } = await splitRecipientsByRole(notificationRecipients);
    const targetClientIds = normalizedAudience === 'broker' ? [] : clientIds;
    const targetBrokerIds = normalizedAudience === 'client' ? [] : brokerIds;

    const summaries: PushNotificationResult[] = [];
    console.info('admin_notification_dispatch_started', {
      audience: normalizedAudience,
      sendToAll,
      requestedRecipients: notificationRecipients.length,
      relatedEntityType: entityType,
      relatedEntityId: numericEntityId,
    });

    if (targetClientIds.length > 0) {
      const summary = await notifyUsers({
        message: trimmedMessage,
        recipientIds: targetClientIds,
        recipientRole: 'client',
        relatedEntityType: entityType,
        relatedEntityId: numericEntityId,
      });
      if (summary) {
        summaries.push(summary);
      }
    }

    if (targetBrokerIds.length > 0) {
      const summary = await notifyUsers({
        message: trimmedMessage,
        recipientIds: targetBrokerIds,
        recipientRole: 'broker',
        relatedEntityType: entityType,
        relatedEntityId: numericEntityId,
      });
      if (summary) {
        summaries.push(summary);
      }
    }

    if (summaries.length === 0) {
      return res.status(200).json({
        message: 'Nenhum destinatário encontrado para envio.',
        push: { requested: 0, success: 0, failure: 0, errorCodes: [] },
      });
    }

    const errorCodes = new Set<string>();
    const combined: PushNotificationResult = {
      requested: 0,
      success: 0,
      failure: 0,
      errorCodes: [],
    };

    for (const summary of summaries) {
      combined.requested += summary.requested;
      combined.success += summary.success;
      combined.failure += summary.failure;
      for (const code of summary.errorCodes) {
        errorCodes.add(code);
      }
    }

    combined.errorCodes = Array.from(errorCodes);

    console.info('admin_notification_dispatch_finished', {
      audience: normalizedAudience,
      requested: combined.requested,
      success: combined.success,
      failure: combined.failure,
      errorCodes: combined.errorCodes,
      relatedEntityType: entityType,
      relatedEntityId: numericEntityId,
    });

    return res
      .status(201)
      .json({ message: 'Notificação enviada com sucesso.', push: combined });
  } catch (error) {
    console.error('Erro ao enviar notificacao:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}








export const adminController = new AdminController();

