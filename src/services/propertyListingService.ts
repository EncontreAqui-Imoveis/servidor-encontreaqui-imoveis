import { RowDataPacket } from 'mysql2';

import { mapProperty } from './propertyDiscoveryService';
import { runPropertyQuery } from './propertyPersistenceService';
import { areaInputToSquareMeters, parseAreaUnidade } from '../utils/propertyAreaUnits';
import { normalizePropertyType } from '../utils/propertyTypes';

type Nullable<T> = T | null;

export class PropertyListingError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function isPropertyListingError(error: unknown): error is PropertyListingError {
  return error instanceof PropertyListingError;
}

const NEGOTIATION_TERMINAL_STATUSES = ['CANCELLED', 'REJECTED', 'EXPIRED', 'SOLD', 'RENTED'];
const NEGOTIATION_PUBLIC_BLOCKING_STATUSES = [
  'DOCUMENTATION_PHASE',
  'IN_NEGOTIATION',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
];

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

interface PropertyAggregateRow extends PropertyRow {
  images?: string | null;
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

function normalizePurpose(value: unknown): Nullable<string> {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
  const map: Record<string, string> = {
    venda: 'Venda',
    comprar: 'Venda',
    aluguel: 'Aluguel',
    alugar: 'Aluguel',
    vendaealuguel: 'Venda e Aluguel',
    vendaaluguel: 'Venda e Aluguel',
  };
  const mapped = map[normalized];
  return mapped ?? null;
}

function parseLocalizedDecimal(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.replace(/R\$\s*/gi, '').replace(/[^\d.,+-]/g, '');
  if (!normalized) {
    return null;
  }
  const hasMinus = normalized.startsWith('-');
  const unsigned = hasMinus || normalized.startsWith('+') ? normalized.slice(1) : normalized;
  const hasComma = unsigned.includes(',');
  const hasDot = unsigned.includes('.');
  let numericLike = unsigned;
  if (hasComma && hasDot) {
    const commaIndex = unsigned.lastIndexOf(',');
    const dotIndex = unsigned.lastIndexOf('.');
    const decimalSeparator = commaIndex > dotIndex ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    numericLike = unsigned
      .split(thousandsSeparator)
      .join('')
      .replace(decimalSeparator, '.');
  } else if (hasComma) {
    numericLike = unsigned.includes(',') && unsigned.split(',').length === 2
      ? unsigned.replace(',', '.')
      : unsigned.split(',').join('');
  }
  const signed = hasMinus ? `-${numericLike}` : numericLike;
  const parsed = Number(signed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseAreaFilterValue(
  rawValue: unknown,
  rawUnit: unknown,
  label: string,
) {
  const normalizedValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const normalizedUnit = Array.isArray(rawUnit) ? rawUnit[0] : rawUnit;
  const unidade = parseAreaUnidade(normalizedUnit);
  if (normalizedValue === undefined || normalizedValue === null || normalizedValue === '') {
    return { valor: null, unidade, m2: null };
  }
  const numeric = Number(String(normalizedValue).replace(',', '.'));
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} inválido.`);
  }
  return {
    valor: numeric,
    unidade,
    m2: Number(areaInputToSquareMeters(numeric, unidade).toFixed(2)),
  };
}

function buildPublicListingWhereClauses(params: {
  type?: unknown;
  purpose?: unknown;
  city?: unknown;
  bairro?: unknown;
  minPriceParam?: unknown;
  maxPriceParam?: unknown;
  min_area_construida?: unknown;
  max_area_construida?: unknown;
  min_area_construida_unidade?: unknown;
  max_area_construida_unidade?: unknown;
  min_area_construida_unit?: unknown;
  max_area_construida_unit?: unknown;
  minAreaConstruida?: unknown;
  maxAreaConstruida?: unknown;
  minAreaConstruidaUnidade?: unknown;
  maxAreaConstruidaUnidade?: unknown;
  minAreaConstruidaUnit?: unknown;
  maxAreaConstruidaUnit?: unknown;
  min_area_terreno?: unknown;
  max_area_terreno?: unknown;
  min_area_terreno_unidade?: unknown;
  max_area_terreno_unidade?: unknown;
  min_area_terreno_unit?: unknown;
  max_area_terreno_unit?: unknown;
  minAreaTerreno?: unknown;
  maxAreaTerreno?: unknown;
  minAreaTerrenoUnidade?: unknown;
  maxAreaTerrenoUnidade?: unknown;
  minAreaTerrenoUnit?: unknown;
  maxAreaTerrenoUnit?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  has_wifi?: unknown;
  tem_piscina?: unknown;
  tem_energia_solar?: unknown;
  tem_automacao?: unknown;
  tem_ar_condicionado?: unknown;
  eh_mobiliada?: unknown;
  searchTerm?: string;
  id?: unknown;
  codeOrId?: unknown;
}) {
  const whereClauses: string[] = [];
  const queryParams: any[] = [];

  whereClauses.push('p.status = ?');
  queryParams.push('approved');
  whereClauses.push("COALESCE(p.visibility, 'PUBLIC') = 'PUBLIC'");

  if (params.type) {
    const normalizedType = normalizePropertyType(params.type);
    if (!normalizedType) {
      throw new PropertyListingError(400, 'Tipo de imóvel inválido.');
    }
    whereClauses.push('p.type = ?');
    queryParams.push(normalizedType);
  }

  const normalizedPurpose = normalizePurpose(params.purpose);
  let priceColumn = 'p.price';
  if (normalizedPurpose) {
    if (normalizedPurpose === 'Venda') {
      whereClauses.push('(p.purpose = ? OR p.purpose = ?)');
      queryParams.push('Venda', 'Venda e Aluguel');
      priceColumn = 'COALESCE(p.price_sale, p.price)';
    } else if (normalizedPurpose === 'Aluguel') {
      whereClauses.push('(p.purpose = ? OR p.purpose = ?)');
      queryParams.push('Aluguel', 'Venda e Aluguel');
      priceColumn = 'COALESCE(p.price_rent, p.price)';
    } else {
      whereClauses.push('p.purpose = ?');
      queryParams.push('Venda e Aluguel');
      priceColumn = 'COALESCE(p.price_sale, p.price)';
    }
  }

  if (params.city) {
    whereClauses.push('p.city LIKE ?');
    queryParams.push(`%${params.city}%`);
  }

  if (params.bairro) {
    whereClauses.push('p.bairro LIKE ?');
    queryParams.push(`%${params.bairro}%`);
  }

  if (params.minPriceParam) {
    const value = Number(params.minPriceParam);
    if (!Number.isNaN(value)) {
      whereClauses.push(`${priceColumn} >= ?`);
      queryParams.push(value);
    }
  }

  if (params.maxPriceParam) {
    const value = Number(params.maxPriceParam);
    if (!Number.isNaN(value)) {
      whereClauses.push(`${priceColumn} <= ?`);
      queryParams.push(value);
    }
  }

  const minAreaConstruida = params['min_area_construida' as keyof typeof params] ?? params['minAreaConstruida' as keyof typeof params];
  const maxAreaConstruida = params['max_area_construida' as keyof typeof params] ?? params['maxAreaConstruida' as keyof typeof params];
  const minAreaConstruidaUnidade = params['min_area_construida_unidade' as keyof typeof params] ?? params['minAreaConstruidaUnidade' as keyof typeof params] ?? params['min_area_construida_unit' as keyof typeof params] ?? params['minAreaConstruidaUnit' as keyof typeof params];
  const maxAreaConstruidaUnidade = params['max_area_construida_unidade' as keyof typeof params] ?? params['maxAreaConstruidaUnidade' as keyof typeof params] ?? params['max_area_construida_unit' as keyof typeof params] ?? params['maxAreaConstruidaUnit' as keyof typeof params];
  const minAreaTerreno = params['min_area_terreno' as keyof typeof params] ?? params['minAreaTerreno' as keyof typeof params];
  const maxAreaTerreno = params['max_area_terreno' as keyof typeof params] ?? params['maxAreaTerreno' as keyof typeof params];
  const minAreaTerrenoUnidade = params['min_area_terreno_unidade' as keyof typeof params] ?? params['minAreaTerrenoUnidade' as keyof typeof params] ?? params['min_area_terreno_unit' as keyof typeof params] ?? params['minAreaTerrenoUnit' as keyof typeof params];
  const maxAreaTerrenoUnidade = params['max_area_terreno_unidade' as keyof typeof params] ?? params['maxAreaTerrenoUnidade' as keyof typeof params] ?? params['max_area_terreno_unit' as keyof typeof params] ?? params['maxAreaTerrenoUnit' as keyof typeof params];

  if (minAreaConstruida != null && String(minAreaConstruida).trim() !== '') {
    const parsed = parseAreaFilterValue(minAreaConstruida, minAreaConstruidaUnidade, 'Filtro de área construída mínima');
    if (parsed.valor != null && parsed.m2 != null) {
      whereClauses.push('COALESCE(p.area_construida_m2, p.area_construida) >= ?');
      queryParams.push(parsed.m2);
    }
  }
  if (maxAreaConstruida != null && String(maxAreaConstruida).trim() !== '') {
    const parsed = parseAreaFilterValue(maxAreaConstruida, maxAreaConstruidaUnidade, 'Filtro de área construída máxima');
    if (parsed.valor != null && parsed.m2 != null) {
      whereClauses.push('COALESCE(p.area_construida_m2, p.area_construida) <= ?');
      queryParams.push(parsed.m2);
    }
  }
  if (minAreaTerreno != null && String(minAreaTerreno).trim() !== '') {
    const parsed = parseAreaFilterValue(minAreaTerreno, minAreaTerrenoUnidade, 'Filtro de área do terreno mínima');
    if (parsed.valor != null && parsed.m2 != null) {
      whereClauses.push('COALESCE(p.area_terreno_m2, p.area_terreno) >= ?');
      queryParams.push(parsed.m2);
    }
  }
  if (maxAreaTerreno != null && String(maxAreaTerreno).trim() !== '') {
    const parsed = parseAreaFilterValue(maxAreaTerreno, maxAreaTerrenoUnidade, 'Filtro de área do terreno máxima');
    if (parsed.valor != null && parsed.m2 != null) {
      whereClauses.push('COALESCE(p.area_terreno_m2, p.area_terreno) <= ?');
      queryParams.push(parsed.m2);
    }
  }

  if (params.bedrooms) {
    const value = Number(params.bedrooms);
    if (!Number.isNaN(value) && value > 0) {
      const normalized = Math.trunc(value);
      if (normalized >= 4) {
        whereClauses.push('p.bedrooms >= ?');
        queryParams.push(4);
      } else {
        whereClauses.push('p.bedrooms = ?');
        queryParams.push(normalized);
      }
    }
  }

  if (params.bathrooms) {
    const value = Number(params.bathrooms);
    if (!Number.isNaN(value) && value > 0) {
      const normalized = Math.trunc(value);
      if (normalized >= 4) {
        whereClauses.push('p.bathrooms >= ?');
        queryParams.push(4);
      } else {
        whereClauses.push('p.bathrooms = ?');
        queryParams.push(normalized);
      }
    }
  }

  for (const [field, value] of [
    ['has_wifi', params.has_wifi],
    ['tem_piscina', params.tem_piscina],
    ['tem_energia_solar', params.tem_energia_solar],
    ['tem_automacao', params.tem_automacao],
    ['tem_ar_condicionado', params.tem_ar_condicionado],
    ['eh_mobiliada', params.eh_mobiliada],
  ] as const) {
    if (value !== undefined) {
      whereClauses.push(`p.${field} = ?`);
      queryParams.push(parseBoolean(value));
    }
  }

  if (params.searchTerm) {
    const term = `%${params.searchTerm}%`;
    whereClauses.push('(p.title LIKE ? OR p.city LIKE ? OR p.address LIKE ? OR p.bairro LIKE ? )');
    queryParams.push(term, term, term, term);
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const idRaw = params.id;
  const idTrimmed = typeof idRaw === 'string' ? idRaw.trim() : '';
  const codeOrIdRaw = params.codeOrId;
  const codeOrId =
    typeof codeOrIdRaw === 'string' && codeOrIdRaw.trim().length > 0 ? codeOrIdRaw.trim() : '';

  if (idTrimmed && uuidRe.test(idTrimmed)) {
    whereClauses.push('p.id = ?');
    queryParams.push(idTrimmed);
  } else if (codeOrId) {
    if (uuidRe.test(codeOrId)) {
      whereClauses.push('p.id = ?');
      queryParams.push(codeOrId);
    } else {
      whereClauses.push('TRIM(p.code) = ?');
      queryParams.push(codeOrId);
    }
  }

  const negotiationPlaceholders = NEGOTIATION_PUBLIC_BLOCKING_STATUSES.map(() => '?').join(', ');
  whereClauses.push(`NOT EXISTS (
    SELECT 1 FROM negotiations nx
    WHERE nx.property_id = p.id
      AND UPPER(TRIM(nx.status)) IN (${negotiationPlaceholders})
  )`);
  queryParams.push(...NEGOTIATION_PUBLIC_BLOCKING_STATUSES);

  return { whereClauses, queryParams, priceColumn };
}

export async function listUserProperties(userId: number) {
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

  return rows.map((row) => mapProperty(row, true));
}

export async function listPublicProperties(query: Record<string, unknown>) {
  const page = typeof query.page === 'string' ? query.page : '1';
  const limit = typeof query.limit === 'string' ? query.limit : '20';
  const type = query.type;
  const purpose = query.purpose;
  const city = query.city;
  const bairro = query.bairro;
  const minPrice = query.minPrice;
  const maxPrice = query.maxPrice;
  const bedrooms = query.bedrooms;
  const bathrooms = query.bathrooms;
  const has_wifi = query.has_wifi;
  const tem_piscina = query.tem_piscina;
  const tem_energia_solar = query.tem_energia_solar;
  const tem_automacao = query.tem_automacao;
  const tem_ar_condicionado = query.tem_ar_condicionado;
  const eh_mobiliada = query.eh_mobiliada;
  const sortBy = query.sortBy ?? query.sort;
  const order = query.order;
  const searchTermRaw = query.searchTerm ?? query.search;
  const searchTerm =
    typeof searchTermRaw === 'string' && searchTermRaw.trim().length > 0
      ? searchTermRaw
      : undefined;

  const numericLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const numericPage = Math.max(Number(page) || 1, 1);
  const offset = (numericPage - 1) * numericLimit;

  let priceColumn = 'p.price';
  let whereClauses: string[];
  let queryParams: any[];
  try {
    ({ whereClauses, queryParams } = buildPublicListingWhereClauses({
      type,
      purpose,
      city,
      bairro,
      minPriceParam: minPrice ?? query.min_price,
      maxPriceParam: maxPrice ?? query.max_price,
      min_area_construida: query.min_area_construida ?? query.minAreaConstruida,
      max_area_construida: query.max_area_construida ?? query.maxAreaConstruida,
      min_area_construida_unidade:
        query.min_area_construida_unidade ?? query.minAreaConstruidaUnidade ?? query.min_area_construida_unit ?? query.minAreaConstruidaUnit,
      max_area_construida_unidade:
        query.max_area_construida_unidade ?? query.maxAreaConstruidaUnidade ?? query.max_area_construida_unit ?? query.maxAreaConstruidaUnit,
      min_area_terreno: query.min_area_terreno ?? query.minAreaTerreno,
      max_area_terreno: query.max_area_terreno ?? query.maxAreaTerreno,
      min_area_terreno_unidade:
        query.min_area_terreno_unidade ?? query.minAreaTerrenoUnidade ?? query.min_area_terreno_unit ?? query.minAreaTerrenoUnit,
      max_area_terreno_unidade:
        query.max_area_terreno_unidade ?? query.maxAreaTerrenoUnidade ?? query.max_area_terreno_unit ?? query.maxAreaTerrenoUnit,
      bedrooms,
      bathrooms,
      has_wifi,
      tem_piscina,
      tem_energia_solar,
      tem_automacao,
      tem_ar_condicionado,
      eh_mobiliada,
      searchTerm,
      id: query.id,
      codeOrId: query.code ?? query.propertyCode,
    }));
  } catch (error) {
    if (isPropertyListingError(error)) {
      throw error;
    }
    throw new PropertyListingError(400, error instanceof Error ? error.message : 'Filtro inválido.');
  }

  if (typeof purpose === 'string') {
    const normalizedPurpose = normalizePurpose(purpose);
    if (normalizedPurpose === 'Venda') {
      priceColumn = 'COALESCE(p.price_sale, p.price)';
    } else if (normalizedPurpose === 'Aluguel') {
      priceColumn = 'COALESCE(p.price_rent, p.price)';
    } else if (normalizedPurpose === 'Venda e Aluguel') {
      priceColumn = 'COALESCE(p.price_sale, p.price)';
    }
  }

  const sortColumnMap: Record<string, string> = {
    price: priceColumn,
    created_at: 'p.created_at',
    area_construida: 'COALESCE(p.area_construida_m2, p.area_construida)',
  };
  const sortColumn = sortColumnMap[String(sortBy ?? '').toLowerCase()] ?? 'p.created_at';
  const sortDirection = String(order ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

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
    [...NEGOTIATION_TERMINAL_STATUSES, ...queryParams, numericLimit, offset]
  );

  const totalRows = await runPropertyQuery<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT p.id) AS total FROM properties p ${where}`,
    queryParams
  );
  const total = Number(totalRows[0]?.total ?? 0);

  return {
    properties: rows.map((row) => mapProperty(row, false)),
    total,
    page: numericPage,
    totalPages: Math.ceil(total / numericLimit),
  };
}
