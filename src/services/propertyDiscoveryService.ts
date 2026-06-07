import { RowDataPacket } from 'mysql2';

import { runPropertyQuery } from './propertyPersistenceService';
import {
  normalizeAreaUnidade,
  type AreaConstruidaUnidade,
} from '../utils/propertyAreaUnits';
import { stripExpiredPromotionFromPublicPayload } from '../utils/promotionPublicWindow';
import { toCanonicalAmenity } from '../utils/propertyAmenities';
const NEGOTIATION_PUBLIC_BLOCKING_STATUSES = [
  'DOCUMENTATION_PHASE',
  'IN_NEGOTIATION',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
];

const NEGOTIATION_TERMINAL_STATUSES = ['CANCELLED', 'REJECTED', 'EXPIRED', 'SOLD', 'RENTED'];

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

type PropertyAggregateRow = PropertyRow;

type PublicPropertyLookup =
  | { kind: 'id'; value: number }
  | { kind: 'public_id'; value: string }
  | { kind: 'public_code'; value: string }
  | { kind: 'code'; value: string };

const PUBLIC_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toBoolean(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

function parsePropertyAmenitiesFromRow(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => {
        const entry = String(item).trim();
        return toCanonicalAmenity(entry) ?? entry;
      })
      .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
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

function mergePropertyAmenities(row: PropertyAggregateRow): string[] {
  const jsonAmenities = parsePropertyAmenitiesFromRow(row.amenities) ?? [];
  const legacyAmenities = [
    ['has_wifi', 'Wi-Fi'],
    ['tem_piscina', 'Piscina'],
    ['tem_energia_solar', 'Energia solar'],
    ['tem_automacao', 'Automação'],
    ['tem_ar_condicionado', 'Ar condicionado'],
    ['eh_mobiliada', 'Mobiliada'],
  ].flatMap(([field, canonical]) => (toBoolean(row[field as keyof PropertyAggregateRow]) ? [canonical] : []));

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
  const normalized = String(label ?? '').trim();
  if (!normalized) return normalized;
  return normalized
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\/[a-z]/g, (match) => `/${match[1].toUpperCase()}`);
}

function normalizePublicAmenities(value: string[] | null): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const seen = new Set<string>();
  const normalized = value
    .map((entry) => {
      const normalizedEntry =
        toCanonicalAmenity(String(entry ?? '')) ?? String(entry ?? '').trim();
      return toPublicAmenityLabel(normalizedEntry);
    })
    .filter((entry) => entry.length > 0)
    .filter((entry) => entry.toUpperCase() !== 'PLANEJADOS');

  for (const entry of normalized) {
    seen.add(entry);
  }

  return Array.from(seen);
}

function normalizePublicCode(value: unknown): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : null;
}

function extractPublicCodeFromValue(raw: unknown): string | null {
  const normalized = String(raw ?? '').trim();
  const fromEnd = normalized.match(/([A-Za-z0-9]{6})$/);
  if (fromEnd?.[1]) {
    const candidate = fromEnd[1];
    const normalizedCandidate = normalizePublicCode(candidate);
    if (normalizedCandidate) {
      return normalizedCandidate;
    }
  }
  return normalizePublicCode(normalized);
}

function resolvePublicPropertyLookup(raw: unknown): PublicPropertyLookup | null {
  const normalized = String(raw ?? '').trim();
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return { kind: 'id', value: Number(normalized) };
  }

  if (PUBLIC_ID_UUID_RE.test(normalized)) {
    return { kind: 'public_id', value: normalized };
  }

  const publicCode = extractPublicCodeFromValue(normalized);
  if (publicCode) {
    return { kind: 'public_code', value: publicCode };
  }

  return { kind: 'code', value: normalized };
}

export function resolvePublicPropertyLookupValue(raw: unknown): PublicPropertyLookup | null {
  return resolvePublicPropertyLookup(raw);
}

function buildPublicPropertyLookupWhereClause(lookup: PublicPropertyLookup): string {
  switch (lookup.kind) {
    case 'id':
      return 'p.id = ?';
    case 'public_id':
      return 'p.public_id = ?';
    case 'public_code':
      return 'p.public_code = ?';
    default:
      return 'TRIM(p.code) = ?';
  }
}

function buildPropertyAggregateSelectClause(includePendingEditRequest: boolean): string {
  return `
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
        ANY_VALUE(nbu.name) AS active_negotiation_client_name
        ${includePendingEditRequest ? ',\n        ANY_VALUE(per.id) AS pending_edit_request_id' : ''}
        ,
        GROUP_CONCAT(DISTINCT pi.image_url ORDER BY pi.id) AS images
    `;
}

function buildPropertyAggregateJoins(includePendingEditRequest: boolean): string {
  return `
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
      ${includePendingEditRequest ? 'LEFT JOIN property_edit_requests per\n        ON per.property_id = p.id\n       AND per.status = \'PENDING\'' : ''}
      LEFT JOIN property_images pi ON pi.property_id = p.id
  `;
}

async function fetchPropertyAggregateByLookup(
  lookup: PublicPropertyLookup,
  options?: { publicOnly?: boolean }
): Promise<PropertyAggregateRow | null> {
  const publicOnly = options?.publicOnly === true;
  const whereClause = buildPublicPropertyLookupWhereClause(lookup);
  const rows = await runPropertyQuery<PropertyAggregateRow[]>(
    `
      ${buildPropertyAggregateSelectClause(true)}
      ${buildPropertyAggregateJoins(true)}
      WHERE ${whereClause}
        ${publicOnly ? "AND p.status = 'approved' AND COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'" : ''}
      GROUP BY p.id
    `,
    [...NEGOTIATION_TERMINAL_STATUSES, lookup.value]
  );

  return rows?.[0] ?? null;
}

export async function getPropertyById(
  propertyId: number,
  options?: { publicOnly?: boolean }
): Promise<PropertyAggregateRow | null> {
  return fetchPropertyAggregateByLookup({ kind: 'id', value: propertyId }, options);
}

export async function getPropertyByPublicLookup(
  raw: unknown,
  options?: { publicOnly?: boolean }
): Promise<PropertyAggregateRow | null> {
  const lookup = resolvePublicPropertyLookup(raw);
  if (!lookup) {
    return null;
  }
  return fetchPropertyAggregateByLookup(lookup, options);
}

export function mapProperty(row: PropertyAggregateRow, includeOwnerInfo = false) {
  const images = row.images ? row.images.split(',').filter(Boolean) : [];
  const mergedAmenities = mergePropertyAmenities(row);
  const activeNegotiationId = row.active_negotiation_id ? String(row.active_negotiation_id) : null;
  const activeNegotiationStatus = row.active_negotiation_status ? String(row.active_negotiation_status) : null;
  const activeNegotiationClientName = row.active_negotiation_client_name
    ? String(row.active_negotiation_client_name)
    : null;
  const activeNegotiationValue =
    row.active_negotiation_value != null ? Number(row.active_negotiation_value) : null;
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
    promotion_price: row.promotion_price != null ? Number(row.promotion_price) : null,
    promotional_rent_price:
      row.promotional_rent_price != null ? Number(row.promotional_rent_price) : null,
    promotional_rent_percentage:
      row.promotional_rent_percentage != null ? Number(row.promotional_rent_percentage) : null,
    promotionalPrice: row.promotion_price != null ? Number(row.promotion_price) : null,
    promotionPrice: row.promotion_price != null ? Number(row.promotion_price) : null,
    promotionalRentPrice:
      row.promotional_rent_price != null ? Number(row.promotional_rent_price) : null,
    promotionalRentPercentage:
      row.promotional_rent_percentage != null ? Number(row.promotional_rent_percentage) : null,
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
    sem_cep: toBoolean(row.sem_cep),
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
    area_construida_unidade: normalizeAreaUnidade(row.area_construida_unidade) as AreaConstruidaUnidade,
    area_construida_valor: row.area_construida_valor != null ? Number(row.area_construida_valor) : null,
    area_construida_m2: row.area_construida_m2 != null ? Number(row.area_construida_m2) : null,
    sem_quadra: toBoolean(row.sem_quadra),
    sem_lote: toBoolean(row.sem_lote),
    area_terreno:
      row.area_terreno_valor != null
        ? Number(row.area_terreno_valor)
        : row.area_terreno_m2 != null
          ? Number(row.area_terreno_m2)
          : row.area_terreno != null
            ? Number(row.area_terreno)
            : null,
    area_terreno_valor: row.area_terreno_valor != null ? Number(row.area_terreno_valor) : null,
    area_terreno_m2: row.area_terreno_m2 != null ? Number(row.area_terreno_m2) : null,
    area_terreno_unidade: normalizeAreaUnidade(row.area_terreno_unidade) as AreaConstruidaUnidade,
    garage_spots: row.garage_spots != null ? Number(row.garage_spots) : null,
    amenities: includeOwnerInfo ? mergedAmenities : normalizePublicAmenities(mergedAmenities),
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
    broker_name: row.broker_name ?? null,
    broker_phone: row.broker_phone ?? null,
    broker_email: row.broker_email ?? null,
    negotiation_id: activeNegotiationId,
    active_negotiation_id: activeNegotiationId,
    activeNegotiationId: activeNegotiationId,
    negotiation,
    activeNegotiation: negotiation,
    hasPendingEditRequest: row.pending_edit_request_id != null && Number(row.pending_edit_request_id) > 0,
    pendingEditRequestId: row.pending_edit_request_id != null ? Number(row.pending_edit_request_id) : null,
    rejection_reason: row.rejection_reason != null ? String(row.rejection_reason) : null,
    rejectionReason: row.rejection_reason != null ? String(row.rejection_reason) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return stripExpiredPromotionFromPublicPayload(mapped, includeOwnerInfo);
}

export async function getAvailableCities() {
  const rows = await runPropertyQuery<RowDataPacket[]>(
    `
      SELECT DISTINCT city
      FROM properties
      WHERE city IS NOT NULL
        AND city <> ''
        AND status = 'approved'
        AND COALESCE(visibility, 'PUBLIC') = 'PUBLIC'
      ORDER BY city ASC
    `,
    []
  );
  return rows.map((row) => row.city);
}

export async function getAvailableCitiesWithCount() {
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
  return rows.map((row) => ({
    city: String(row.city ?? '').trim(),
    total: Number(row.total ?? 0),
  }));
}

export async function getAvailableBairrosWithCount(city: string) {
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

  return rows.map((row) => ({
    bairro: String(row.bairro ?? '').trim(),
    city: String(row.city ?? '').trim(),
    total: Number(row.total ?? 0),
  }));
}

export async function listFeaturedProperties(params: {
  scope?: string;
  page?: string | number;
  limit?: string | number;
}) {
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 20);
  const page = Math.max(Number(params.page) || 1, 1);
  const offset = (page - 1) * limit;
  const scopeParam = String(params.scope ?? 'sale').toLowerCase();
  const scope: 'sale' | 'rent' = scopeParam === 'rent' ? 'rent' : 'sale';

  const rows = await runPropertyQuery<PropertyAggregateRow[]>(
    `
      ${buildPropertyAggregateSelectClause(false)}
      FROM featured_properties fp
      JOIN properties p ON p.id = fp.property_id
      ${buildPropertyAggregateJoins(false)}
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
    [...NEGOTIATION_PUBLIC_BLOCKING_STATUSES, scope, ...NEGOTIATION_PUBLIC_BLOCKING_STATUSES, limit, offset]
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
    `,
    [scope, ...NEGOTIATION_PUBLIC_BLOCKING_STATUSES]
  );

  const total = Number(countRows[0]?.total ?? 0);

  return {
    properties: rows.map((row) => mapProperty(row, false)),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}
