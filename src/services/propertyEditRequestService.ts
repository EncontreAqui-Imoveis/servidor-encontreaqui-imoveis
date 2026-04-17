import { normalizePropertyType } from '../utils/propertyTypes';

export type PropertyEditRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type PropertyEditRequestRequesterRole = 'broker' | 'client';

type PurposeValue = 'Venda' | 'Aluguel' | 'Venda e Aluguel';
type TipoLoteValue = 'meio' | 'inteiro' | null;

const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_GENERIC_PROPERTY_TEXT_LENGTH = 120;
const MAX_PROPERTY_COUNT = 99;
const MAX_PROPERTY_AREA = 9999999.99;
const MAX_PROPERTY_PRICE = 9999999999.99;
const MAX_PROPERTY_FEE = 99999999.99;

const PURPOSE_MAP: Record<string, PurposeValue> = {
  venda: 'Venda',
  comprar: 'Venda',
  aluguel: 'Aluguel',
  alugar: 'Aluguel',
  vendaealuguel: 'Venda e Aluguel',
  vendaaluguel: 'Venda e Aluguel',
};

const ALLOWED_TEXT_LENGTHS: Record<string, number> = {
  title: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  ownerName: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  address: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  bairro: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  city: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  code: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  state: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  complemento: MAX_GENERIC_PROPERTY_TEXT_LENGTH,
  cep: 20,
  numero: 25,
  quadra: 25,
  lote: 25,
  tipoLote: 25,
};

const EDIT_FIELD_ALIASES = {
  title: ['title'],
  description: ['description'],
  type: ['type'],
  purpose: ['purpose'],
  code: ['code'],
  ownerName: ['ownerName', 'owner_name'],
  ownerPhone: ['ownerPhone', 'owner_phone'],
  address: ['address'],
  quadra: ['quadra'],
  lote: ['lote'],
  numero: ['numero'],
  semNumero: ['semNumero', 'sem_numero'],
  bairro: ['bairro'],
  complemento: ['complemento'],
  tipoLote: ['tipoLote', 'tipo_lote'],
  city: ['city'],
  state: ['state'],
  cep: ['cep'],
  bedrooms: ['bedrooms'],
  bathrooms: ['bathrooms'],
  areaConstruida: ['areaConstruida', 'area_construida', 'area'],
  areaTerreno: ['areaTerreno', 'area_terreno'],
  garageSpots: ['garageSpots', 'garage_spots'],
  hasWifi: ['hasWifi', 'has_wifi'],
  temPiscina: ['temPiscina', 'tem_piscina'],
  temEnergiaSolar: ['temEnergiaSolar', 'tem_energia_solar'],
  temAutomacao: ['temAutomacao', 'tem_automacao'],
  temArCondicionado: ['temArCondicionado', 'tem_ar_condicionado'],
  ehMobiliada: ['ehMobiliada', 'eh_mobiliada'],
  valorCondominio: ['valorCondominio', 'valor_condominio'],
  price: ['price'],
  priceSale: ['priceSale', 'price_sale', 'salePrice', 'sale_price'],
  priceRent: ['priceRent', 'price_rent', 'rentPrice', 'rent_price'],
  isPromoted: ['isPromoted', 'is_promoted'],
  promotionPercentage: [
    'promotionPercentage',
    'promotion_percentage',
    'promoPercentage',
    'promo_percentage',
  ],
  promotionPrice: [
    'promotionPrice',
    'promotion_price',
    'promotionalPrice',
    'promotional_price',
  ],
  promotionalRentPrice: [
    'promotionalRentPrice',
    'promotional_rent_price',
    'promotionRentPrice',
    'promotion_rent_price',
  ],
  promotionalRentPercentage: [
    'promotionalRentPercentage',
    'promotional_rent_percentage',
  ],
  promotionStart: [
    'promotionStart',
    'promotion_start',
    'promoStartDate',
    'promo_start_date',
  ],
  promotionEnd: [
    'promotionEnd',
    'promotion_end',
    'promoEndDate',
    'promo_end_date',
  ],
  semQuadra: ['semQuadra', 'sem_quadra'],
  semLote: ['semLote', 'sem_lote'],
  areaConstruidaUnidade: [
    'areaConstruidaUnidade',
    'area_construida_unidade',
    'areaConstruida_unidade',
  ],
} as const;

type AreaConstruidaUnidadeValue = 'm2' | 'alqueire' | 'hectare';

function normalizeAreaConstruidaUnidade(value: unknown): AreaConstruidaUnidadeValue {
  const s = String(value ?? 'm2')
    .trim()
    .toLowerCase();
  if (s === 'hectare' || s === 'ha') return 'hectare';
  if (s === 'alqueire' || s === 'alq') return 'alqueire';
  return 'm2';
}

export type EditablePropertyState = {
  title: string;
  description: string;
  type: string;
  purpose: PurposeValue;
  code: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  address: string;
  quadra: string | null;
  lote: string | null;
  numero: string | null;
  bairro: string | null;
  complemento: string | null;
  tipoLote: TipoLoteValue;
  city: string;
  state: string;
  cep: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaConstruida: number | null;
  /** Unidade em que o usuário informou a área construída; `areaConstruida` permanece em m². */
  areaConstruidaUnidade: AreaConstruidaUnidadeValue;
  semQuadra: boolean;
  semLote: boolean;
  areaTerreno: number | null;
  garageSpots: number | null;
  hasWifi: boolean;
  temPiscina: boolean;
  temEnergiaSolar: boolean;
  temAutomacao: boolean;
  temArCondicionado: boolean;
  ehMobiliada: boolean;
  valorCondominio: number | null;
  priceSale: number | null;
  priceRent: number | null;
  isPromoted: boolean;
  promotionPercentage: number | null;
  promotionPrice: number | null;
  promotionalRentPrice: number | null;
  promotionalRentPercentage: number | null;
  promotionStart: string | null;
  promotionEnd: string | null;
};

export type EditablePropertyPatch = Partial<EditablePropertyState>;

export type EditablePropertyDiff = Record<
  string,
  {
    before: unknown;
    after: unknown;
  }
>;

type PropertyRowLike = Record<string, unknown>;

type PreparePatchResult = {
  patch: EditablePropertyPatch;
  before: EditablePropertyPatch;
  after: EditablePropertyPatch;
  diff: EditablePropertyDiff;
};

function normalizePurpose(value: unknown): PurposeValue | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
  return PURPOSE_MAP[normalized] ?? null;
}

function normalizeTipoLote(value: unknown): TipoLoteValue {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'meio') return 'meio';
  if (normalized === 'inteiro') return 'inteiro';
  throw new Error('Tipo de lote invalido.');
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'sim', 'yes', 'on'].includes(normalized);
}

function parseInteger(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} invalido.`);
  }
  return Math.trunc(parsed);
}

function parseDecimal(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} invalido.`);
  }
  return Number(parsed.toFixed(2));
}

function parsePrice(value: unknown, label: string): number | null {
  const parsed = parseDecimal(value, label);
  if (parsed == null) return null;
  if (parsed < 0) {
    throw new Error(`${label} invalido.`);
  }
  return parsed;
}

function parsePromotionPercentage(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
    throw new Error('Percentual de promocao invalido. Use valor entre 1 e 99.');
  }
  return Number(parsed.toFixed(2));
}

function normalizeDateTime(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Data de promocao invalida.');
  }
  return parsed.toISOString();
}

function formatSqlDateTime(isoValue: string | null): string | null {
  if (!isoValue) return null;
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function formatSqlDate(isoValue: string | null): string | null {
  if (!isoValue) return null;
  const parsed = new Date(isoValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function validateTextLength(
  key: keyof typeof ALLOWED_TEXT_LENGTHS,
  value: string | null
): void {
  if (value == null) return;
  const maxLength = ALLOWED_TEXT_LENGTHS[key];
  if (value.length > maxLength) {
    throw new Error(`${resolveFieldLabel(key)} deve ter no maximo ${maxLength} caracteres.`);
  }
}

function validateNumericRange(
  label: string,
  value: number | null,
  max: number,
  allowNull = true
): void {
  if (value == null) {
    if (allowNull) return;
    throw new Error(`${label} invalido.`);
  }
  if (value < 0 || value > max) {
    throw new Error(`${label} invalido.`);
  }
}

function resolveFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    title: 'Titulo',
    description: 'Descricao',
    ownerName: 'Nome do proprietario',
    ownerPhone: 'Telefone do proprietario',
    address: 'Endereco',
    bairro: 'Bairro',
    city: 'Cidade',
    code: 'Codigo',
    numero: 'Numero',
    quadra: 'Quadra',
    lote: 'Lote',
    tipoLote: 'Tipo de lote',
    priceSale: 'Preco de venda',
    priceRent: 'Preco de aluguel',
    valorCondominio: 'Valor de condominio',
    bedrooms: 'Quartos',
    bathrooms: 'Banheiros',
    garageSpots: 'Garagens',
    areaConstruida: 'Area construida',
    areaTerreno: 'Area do terreno',
  };
  return labels[key] ?? key;
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function readAlias(
  source: Record<string, unknown>,
  aliases: readonly string[]
): { found: boolean; value: unknown } {
  for (const alias of aliases) {
    if (hasOwn(source, alias)) {
      return { found: true, value: source[alias] };
    }
  }
  return { found: false, value: undefined };
}

function supportsSale(purpose: PurposeValue): boolean {
  return purpose === 'Venda' || purpose === 'Venda e Aluguel';
}

function supportsRent(purpose: PurposeValue): boolean {
  return purpose === 'Aluguel' || purpose === 'Venda e Aluguel';
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function toNullableInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function normalizeCurrentDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deriveListingPrice(
  purpose: PurposeValue,
  priceSale: number | null,
  priceRent: number | null,
  fallbackPrice: number | null
): number | null {
  if (supportsSale(purpose) && !supportsRent(purpose)) {
    return priceSale ?? fallbackPrice;
  }
  if (supportsRent(purpose) && !supportsSale(purpose)) {
    return priceRent ?? fallbackPrice;
  }
  return priceSale ?? priceRent ?? fallbackPrice;
}

function calculateDiscountedValue(
  baseValue: number | null,
  percentage: number | null
): number | null {
  if (baseValue == null || baseValue <= 0 || percentage == null) {
    return null;
  }
  if (percentage <= 0 || percentage >= 100) {
    return null;
  }
  const discounted = baseValue * (1 - percentage / 100);
  if (!Number.isFinite(discounted) || discounted <= 0) {
    return null;
  }
  return Number(discounted.toFixed(2));
}

export function buildEditablePropertyState(
  property: PropertyRowLike
): EditablePropertyState {
  const purpose = normalizePurpose(property.purpose) ?? 'Venda';
  const rawPrice = toNullableNumber(property.price);
  const rawSalePrice = toNullableNumber(property.price_sale);
  const rawRentPrice = toNullableNumber(property.price_rent);
  const salePrice =
    rawSalePrice ?? (supportsSale(purpose) && !supportsRent(purpose) ? rawPrice : null);
  const rentPrice =
    rawRentPrice ?? (supportsRent(purpose) && !supportsSale(purpose) ? rawPrice : null);
  const promotionPercentage =
    toNullableNumber(property.promo_percentage) ??
    toNullableNumber(property.promotion_percentage);
  const promotionStart =
    normalizeCurrentDate(property.promotion_start) ??
    normalizeCurrentDate(property.promo_start_date);
  const promotionEnd =
    normalizeCurrentDate(property.promotion_end) ??
    normalizeCurrentDate(property.promo_end_date);
  const isPromoted =
    parseBoolean(property.is_promoted) ||
    promotionPercentage != null ||
    toNullableNumber(property.promotion_price) != null ||
    toNullableNumber(property.promotional_rent_price) != null;

  return {
    title: String(property.title ?? '').trim(),
    description: String(property.description ?? '').trim(),
    type: String(property.type ?? '').trim(),
    purpose,
    code: stringOrNull(property.code),
    ownerName: stringOrNull(property.owner_name),
    ownerPhone: stringOrNull(property.owner_phone),
    address: String(property.address ?? '').trim(),
    quadra: stringOrNull(property.quadra),
    lote: stringOrNull(property.lote),
    numero: stringOrNull(property.numero),
    bairro: stringOrNull(property.bairro),
    complemento: stringOrNull(property.complemento),
    tipoLote: normalizeTipoLote(property.tipo_lote),
    city: String(property.city ?? '').trim(),
    state: String(property.state ?? '').trim(),
    cep: stringOrNull(property.cep),
    bedrooms: toNullableInteger(property.bedrooms),
    bathrooms: toNullableInteger(property.bathrooms),
    areaConstruida: toNullableNumber(property.area_construida),
    areaConstruidaUnidade: normalizeAreaConstruidaUnidade(
      (property as Record<string, unknown>).area_construida_unidade
    ),
    semQuadra: parseBoolean((property as Record<string, unknown>).sem_quadra),
    semLote: parseBoolean((property as Record<string, unknown>).sem_lote),
    areaTerreno: toNullableNumber(property.area_terreno),
    garageSpots: toNullableInteger(property.garage_spots),
    hasWifi: parseBoolean(property.has_wifi),
    temPiscina: parseBoolean(property.tem_piscina),
    temEnergiaSolar: parseBoolean(property.tem_energia_solar),
    temAutomacao: parseBoolean(property.tem_automacao),
    temArCondicionado: parseBoolean(property.tem_ar_condicionado),
    ehMobiliada: parseBoolean(property.eh_mobiliada),
    valorCondominio: toNullableNumber(property.valor_condominio),
    priceSale: salePrice,
    priceRent: rentPrice,
    isPromoted,
    promotionPercentage,
    promotionPrice: toNullableNumber(property.promotion_price),
    promotionalRentPrice: toNullableNumber(property.promotional_rent_price),
    promotionalRentPercentage: toNullableNumber(property.promotional_rent_percentage),
    promotionStart,
    promotionEnd,
  };
}

function validateCurrentState(state: EditablePropertyState): void {
  if (!state.title) {
    throw new Error('Titulo e obrigatorio.');
  }
  if (!state.description || state.description.length > MAX_PROPERTY_DESCRIPTION_LENGTH) {
    throw new Error(
      `Descricao deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`
    );
  }
  if (!state.type) {
    throw new Error('Tipo de imovel invalido.');
  }
  if (!state.address || !state.city || !state.state) {
    throw new Error('Endereco, cidade e estado sao obrigatorios.');
  }
  if (!state.tipoLote) {
    throw new Error('Tipo de lote e obrigatorio.');
  }

  validateTextLength('title', state.title);
  validateTextLength('ownerName', state.ownerName);
  validateTextLength('address', state.address);
  validateTextLength('bairro', state.bairro);
  validateTextLength('city', state.city);
  validateTextLength('code', state.code);
  validateTextLength('state', state.state);
  validateTextLength('complemento', state.complemento);
  validateTextLength('cep', state.cep);
  validateTextLength('numero', state.numero);
  validateTextLength('quadra', state.quadra);
  validateTextLength('lote', state.lote);
  validateTextLength('tipoLote', state.tipoLote);

  if (state.ownerPhone != null) {
    const digits = normalizeDigits(state.ownerPhone);
    if (digits.length < 10 || digits.length > 13) {
      throw new Error('Telefone do proprietario invalido.');
    }
  }

  validateNumericRange('Preco de venda', state.priceSale, MAX_PROPERTY_PRICE);
  validateNumericRange('Preco de aluguel', state.priceRent, MAX_PROPERTY_PRICE);
  validateNumericRange('Valor de condominio', state.valorCondominio, MAX_PROPERTY_FEE);
  validateNumericRange('Quartos', state.bedrooms, MAX_PROPERTY_COUNT);
  validateNumericRange('Banheiros', state.bathrooms, MAX_PROPERTY_COUNT);
  validateNumericRange('Garagens', state.garageSpots, MAX_PROPERTY_COUNT);
  validateNumericRange('Area construida', state.areaConstruida, MAX_PROPERTY_AREA);
  validateNumericRange('Area do terreno', state.areaTerreno, MAX_PROPERTY_AREA);

  if (
    state.promotionPrice != null &&
    state.priceSale != null &&
    state.promotionPrice >= state.priceSale
  ) {
    throw new Error('Preco promocional de venda deve ser menor que o preco de venda.');
  }

  if (
    state.promotionalRentPrice != null &&
    state.priceRent != null &&
    state.promotionalRentPrice >= state.priceRent
  ) {
    throw new Error('Preco promocional de aluguel deve ser menor que o preco de aluguel.');
  }
}

function buildRequestedPatch(
  payload: Record<string, unknown>,
  current: EditablePropertyState
): EditablePropertyPatch {
  const patch: EditablePropertyPatch = {};

  const title = readAlias(payload, EDIT_FIELD_ALIASES.title);
  if (title.found) {
    const value = stringOrNull(title.value);
    if (!value) throw new Error('Titulo e obrigatorio.');
    patch.title = value;
  }

  const description = readAlias(payload, EDIT_FIELD_ALIASES.description);
  if (description.found) {
    const value = stringOrNull(description.value);
    if (!value) {
      throw new Error(
        `Descricao deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`
      );
    }
    patch.description = value;
  }

  const type = readAlias(payload, EDIT_FIELD_ALIASES.type);
  if (type.found) {
    const normalizedType = normalizePropertyType(type.value);
    if (!normalizedType) {
      throw new Error('Tipo de imovel invalido.');
    }
    patch.type = normalizedType;
  }

  const purpose = readAlias(payload, EDIT_FIELD_ALIASES.purpose);
  if (purpose.found) {
    const normalizedPurpose = normalizePurpose(purpose.value);
    if (!normalizedPurpose) {
      throw new Error('Finalidade do imovel invalida.');
    }
    patch.purpose = normalizedPurpose;
  }

  const code = readAlias(payload, EDIT_FIELD_ALIASES.code);
  if (code.found) patch.code = stringOrNull(code.value);

  const ownerName = readAlias(payload, EDIT_FIELD_ALIASES.ownerName);
  if (ownerName.found) patch.ownerName = stringOrNull(ownerName.value);

  const ownerPhone = readAlias(payload, EDIT_FIELD_ALIASES.ownerPhone);
  if (ownerPhone.found) patch.ownerPhone = stringOrNull(ownerPhone.value);

  const address = readAlias(payload, EDIT_FIELD_ALIASES.address);
  if (address.found) {
    const value = stringOrNull(address.value);
    if (!value) throw new Error('Endereco e obrigatorio.');
    patch.address = value;
  }

  const quadra = readAlias(payload, EDIT_FIELD_ALIASES.quadra);
  if (quadra.found) patch.quadra = stringOrNull(quadra.value);

  const lote = readAlias(payload, EDIT_FIELD_ALIASES.lote);
  if (lote.found) patch.lote = stringOrNull(lote.value);

  const semNumero = readAlias(payload, EDIT_FIELD_ALIASES.semNumero);
  const numero = readAlias(payload, EDIT_FIELD_ALIASES.numero);
  if (semNumero.found && parseBoolean(semNumero.value)) {
    patch.numero = null;
  } else if (numero.found) {
    const digits = normalizeDigits(numero.value);
    patch.numero = digits.length > 0 ? digits : null;
  }

  const bairro = readAlias(payload, EDIT_FIELD_ALIASES.bairro);
  if (bairro.found) patch.bairro = stringOrNull(bairro.value);

  const complemento = readAlias(payload, EDIT_FIELD_ALIASES.complemento);
  if (complemento.found) patch.complemento = stringOrNull(complemento.value);

  const tipoLote = readAlias(payload, EDIT_FIELD_ALIASES.tipoLote);
  if (tipoLote.found) patch.tipoLote = normalizeTipoLote(tipoLote.value);

  const city = readAlias(payload, EDIT_FIELD_ALIASES.city);
  if (city.found) {
    const value = stringOrNull(city.value);
    if (!value) throw new Error('Cidade e obrigatoria.');
    patch.city = value;
  }

  const state = readAlias(payload, EDIT_FIELD_ALIASES.state);
  if (state.found) {
    const value = stringOrNull(state.value);
    if (!value) throw new Error('Estado e obrigatorio.');
    patch.state = value;
  }

  const cep = readAlias(payload, EDIT_FIELD_ALIASES.cep);
  if (cep.found) patch.cep = stringOrNull(cep.value);

  const bedrooms = readAlias(payload, EDIT_FIELD_ALIASES.bedrooms);
  if (bedrooms.found) patch.bedrooms = parseInteger(bedrooms.value, 'Quartos');

  const bathrooms = readAlias(payload, EDIT_FIELD_ALIASES.bathrooms);
  if (bathrooms.found) patch.bathrooms = parseInteger(bathrooms.value, 'Banheiros');

  const areaConstruida = readAlias(payload, EDIT_FIELD_ALIASES.areaConstruida);
  if (areaConstruida.found) {
    patch.areaConstruida = parseDecimal(areaConstruida.value, 'Area construida');
  }

  const areaTerreno = readAlias(payload, EDIT_FIELD_ALIASES.areaTerreno);
  if (areaTerreno.found) {
    patch.areaTerreno = parseDecimal(areaTerreno.value, 'Area do terreno');
  }

  const semQuadra = readAlias(payload, EDIT_FIELD_ALIASES.semQuadra);
  if (semQuadra.found) patch.semQuadra = parseBoolean(semQuadra.value);

  const semLote = readAlias(payload, EDIT_FIELD_ALIASES.semLote);
  if (semLote.found) patch.semLote = parseBoolean(semLote.value);

  const areaConstruidaUnidade = readAlias(
    payload,
    EDIT_FIELD_ALIASES.areaConstruidaUnidade
  );
  if (areaConstruidaUnidade.found) {
    patch.areaConstruidaUnidade = normalizeAreaConstruidaUnidade(areaConstruidaUnidade.value);
  }

  const garageSpots = readAlias(payload, EDIT_FIELD_ALIASES.garageSpots);
  if (garageSpots.found) {
    patch.garageSpots = parseInteger(garageSpots.value, 'Garagens');
  }

  const hasWifi = readAlias(payload, EDIT_FIELD_ALIASES.hasWifi);
  if (hasWifi.found) patch.hasWifi = parseBoolean(hasWifi.value);

  const temPiscina = readAlias(payload, EDIT_FIELD_ALIASES.temPiscina);
  if (temPiscina.found) patch.temPiscina = parseBoolean(temPiscina.value);

  const temEnergiaSolar = readAlias(payload, EDIT_FIELD_ALIASES.temEnergiaSolar);
  if (temEnergiaSolar.found) {
    patch.temEnergiaSolar = parseBoolean(temEnergiaSolar.value);
  }

  const temAutomacao = readAlias(payload, EDIT_FIELD_ALIASES.temAutomacao);
  if (temAutomacao.found) patch.temAutomacao = parseBoolean(temAutomacao.value);

  const temArCondicionado = readAlias(payload, EDIT_FIELD_ALIASES.temArCondicionado);
  if (temArCondicionado.found) {
    patch.temArCondicionado = parseBoolean(temArCondicionado.value);
  }

  const ehMobiliada = readAlias(payload, EDIT_FIELD_ALIASES.ehMobiliada);
  if (ehMobiliada.found) patch.ehMobiliada = parseBoolean(ehMobiliada.value);

  const valorCondominio = readAlias(payload, EDIT_FIELD_ALIASES.valorCondominio);
  if (valorCondominio.found) {
    patch.valorCondominio = parseDecimal(valorCondominio.value, 'Valor de condominio');
  }

  const purposeForPrices = patch.purpose ?? current.purpose;
  const priceSale = readAlias(payload, EDIT_FIELD_ALIASES.priceSale);
  if (priceSale.found) {
    patch.priceSale = parsePrice(priceSale.value, 'Preco de venda');
  }

  const priceRent = readAlias(payload, EDIT_FIELD_ALIASES.priceRent);
  if (priceRent.found) {
    patch.priceRent = parsePrice(priceRent.value, 'Preco de aluguel');
  }

  const basePrice = readAlias(payload, EDIT_FIELD_ALIASES.price);
  if (basePrice.found && !priceSale.found && !priceRent.found) {
    const parsed = parsePrice(basePrice.value, 'Preco base');
    if (supportsSale(purposeForPrices) && !supportsRent(purposeForPrices)) {
      patch.priceSale = parsed;
    } else if (supportsRent(purposeForPrices) && !supportsSale(purposeForPrices)) {
      patch.priceRent = parsed;
    } else {
      patch.priceSale = parsed;
    }
  }

  const isPromoted = readAlias(payload, EDIT_FIELD_ALIASES.isPromoted);
  if (isPromoted.found) patch.isPromoted = parseBoolean(isPromoted.value);

  const promotionPercentage = readAlias(
    payload,
    EDIT_FIELD_ALIASES.promotionPercentage
  );
  if (promotionPercentage.found) {
    patch.promotionPercentage = parsePromotionPercentage(promotionPercentage.value);
  }

  const promotionPrice = readAlias(payload, EDIT_FIELD_ALIASES.promotionPrice);
  if (promotionPrice.found) {
    patch.promotionPrice = parsePrice(promotionPrice.value, 'Preco promocional de venda');
  }

  const promotionalRentPrice = readAlias(
    payload,
    EDIT_FIELD_ALIASES.promotionalRentPrice
  );
  if (promotionalRentPrice.found) {
    patch.promotionalRentPrice = parsePrice(
      promotionalRentPrice.value,
      'Preco promocional de aluguel'
    );
  }

  const promotionalRentPercentage = readAlias(
    payload,
    EDIT_FIELD_ALIASES.promotionalRentPercentage
  );
  if (promotionalRentPercentage.found) {
    patch.promotionalRentPercentage = parsePromotionPercentage(
      promotionalRentPercentage.value
    );
  }

  const promotionStart = readAlias(payload, EDIT_FIELD_ALIASES.promotionStart);
  if (promotionStart.found) {
    patch.promotionStart = normalizeDateTime(promotionStart.value);
  }

  const promotionEnd = readAlias(payload, EDIT_FIELD_ALIASES.promotionEnd);
  if (promotionEnd.found) {
    patch.promotionEnd = normalizeDateTime(promotionEnd.value);
  }

  return patch;
}

function finalizePatch(
  current: EditablePropertyState,
  rawPatch: EditablePropertyPatch
): EditablePropertyPatch {
  const merged: EditablePropertyState = { ...current, ...rawPatch };

  if (rawPatch.semQuadra === true) {
    merged.quadra = null;
  }
  if (rawPatch.semLote === true) {
    merged.lote = null;
  }

  const shouldEnablePromotion =
    rawPatch.isPromoted === true ||
    merged.isPromoted === true ||
    rawPatch.promotionPercentage != null ||
    rawPatch.promotionPrice != null ||
    rawPatch.promotionalRentPrice != null ||
    rawPatch.promotionalRentPercentage != null ||
    rawPatch.promotionStart != null ||
    rawPatch.promotionEnd != null;

  if (rawPatch.isPromoted === false) {
    merged.isPromoted = false;
    merged.promotionPercentage = null;
    merged.promotionPrice = null;
    merged.promotionalRentPrice = null;
    merged.promotionalRentPercentage = null;
    merged.promotionStart = null;
    merged.promotionEnd = null;
  } else if (shouldEnablePromotion) {
    merged.isPromoted = true;
    if (rawPatch.promotionPercentage != null) {
      merged.promotionPrice =
        rawPatch.promotionPrice ??
        calculateDiscountedValue(merged.priceSale, merged.promotionPercentage);
      merged.promotionalRentPrice =
        rawPatch.promotionalRentPrice ??
        calculateDiscountedValue(merged.priceRent, merged.promotionPercentage);
    }
  }

  validateCurrentState(merged);

  const finalPatch: EditablePropertyPatch = { ...rawPatch };
  if (
    rawPatch.isPromoted !== undefined ||
    rawPatch.promotionPercentage !== undefined ||
    rawPatch.promotionPrice !== undefined ||
    rawPatch.promotionalRentPrice !== undefined ||
    rawPatch.promotionalRentPercentage !== undefined ||
    rawPatch.promotionStart !== undefined ||
    rawPatch.promotionEnd !== undefined
  ) {
    finalPatch.isPromoted = merged.isPromoted;
    finalPatch.promotionPercentage = merged.promotionPercentage;
    finalPatch.promotionPrice = merged.promotionPrice;
    finalPatch.promotionalRentPrice = merged.promotionalRentPrice;
    finalPatch.promotionalRentPercentage = merged.promotionalRentPercentage;
    finalPatch.promotionStart = merged.promotionStart;
    finalPatch.promotionEnd = merged.promotionEnd;
  }

  return finalPatch;
}

export function preparePropertyEditPatch(
  payload: Record<string, unknown>,
  current: EditablePropertyState
): PreparePatchResult {
  const requestedPatch = buildRequestedPatch(payload, current);
  const normalizedPatch = finalizePatch(current, requestedPatch);

  const before: EditablePropertyPatch = {};
  const after: EditablePropertyPatch = {};
  const diff: EditablePropertyDiff = {};

  for (const [key, value] of Object.entries(normalizedPatch)) {
    const currentValue = current[key as keyof EditablePropertyState];
    if (valuesEqual(currentValue, value)) {
      continue;
    }
    before[key as keyof EditablePropertyPatch] = currentValue as never;
    after[key as keyof EditablePropertyPatch] = value as never;
    diff[key] = {
      before: currentValue,
      after: value,
    };
  }

  return {
    patch: after,
    before,
    after,
    diff,
  };
}

export function buildPropertyEditDbPatch(
  current: EditablePropertyState,
  patch: EditablePropertyPatch
): Record<string, unknown> {
  const finalState: EditablePropertyState = { ...current, ...patch };
  validateCurrentState(finalState);

  const dbPatch: Record<string, unknown> = {};

  for (const key of Object.keys(patch)) {
    switch (key) {
      case 'title':
      case 'description':
      case 'type':
      case 'code':
      case 'address':
      case 'quadra':
      case 'lote':
      case 'bairro':
      case 'complemento':
      case 'city':
      case 'state':
      case 'cep':
        dbPatch[key] = finalState[key as keyof EditablePropertyState];
        break;
      case 'ownerName':
        dbPatch.owner_name = finalState.ownerName;
        break;
      case 'ownerPhone':
        dbPatch.owner_phone = finalState.ownerPhone ? normalizeDigits(finalState.ownerPhone) : null;
        break;
      case 'numero':
        dbPatch.numero = finalState.numero;
        break;
      case 'tipoLote':
        dbPatch.tipo_lote = finalState.tipoLote;
        break;
      case 'bedrooms':
        dbPatch.bedrooms = finalState.bedrooms;
        break;
      case 'bathrooms':
        dbPatch.bathrooms = finalState.bathrooms;
        break;
      case 'areaConstruida':
        dbPatch.area_construida = finalState.areaConstruida;
        break;
      case 'areaConstruidaUnidade':
        dbPatch.area_construida_unidade = finalState.areaConstruidaUnidade;
        break;
      case 'semQuadra':
        dbPatch.sem_quadra = finalState.semQuadra ? 1 : 0;
        break;
      case 'semLote':
        dbPatch.sem_lote = finalState.semLote ? 1 : 0;
        break;
      case 'areaTerreno':
        dbPatch.area_terreno = finalState.areaTerreno;
        break;
      case 'garageSpots':
        dbPatch.garage_spots = finalState.garageSpots;
        break;
      case 'hasWifi':
        dbPatch.has_wifi = finalState.hasWifi ? 1 : 0;
        break;
      case 'temPiscina':
        dbPatch.tem_piscina = finalState.temPiscina ? 1 : 0;
        break;
      case 'temEnergiaSolar':
        dbPatch.tem_energia_solar = finalState.temEnergiaSolar ? 1 : 0;
        break;
      case 'temAutomacao':
        dbPatch.tem_automacao = finalState.temAutomacao ? 1 : 0;
        break;
      case 'temArCondicionado':
        dbPatch.tem_ar_condicionado = finalState.temArCondicionado ? 1 : 0;
        break;
      case 'ehMobiliada':
        dbPatch.eh_mobiliada = finalState.ehMobiliada ? 1 : 0;
        break;
      case 'valorCondominio':
        dbPatch.valor_condominio = finalState.valorCondominio;
        break;
      case 'priceSale':
      case 'priceRent':
      case 'purpose': {
        dbPatch.purpose = finalState.purpose;
        dbPatch.price_sale = finalState.priceSale;
        dbPatch.price_rent = finalState.priceRent;
        const listingPrice = deriveListingPrice(
          finalState.purpose,
          finalState.priceSale,
          finalState.priceRent,
          null
        );
        if (listingPrice != null) {
          dbPatch.price = listingPrice;
        }
        break;
      }
      case 'isPromoted':
      case 'promotionPercentage':
      case 'promotionPrice':
      case 'promotionalRentPrice':
      case 'promotionalRentPercentage':
      case 'promotionStart':
      case 'promotionEnd':
        dbPatch.is_promoted = finalState.isPromoted ? 1 : 0;
        dbPatch.promotion_percentage = finalState.promotionPercentage;
        dbPatch.promo_percentage = finalState.promotionPercentage;
        dbPatch.promotion_price = finalState.promotionPrice;
        dbPatch.promotional_rent_price = finalState.promotionalRentPrice;
        dbPatch.promotional_rent_percentage = finalState.promotionalRentPercentage;
        dbPatch.promotion_start = formatSqlDateTime(finalState.promotionStart);
        dbPatch.promotion_end = formatSqlDateTime(finalState.promotionEnd);
        dbPatch.promo_start_date = formatSqlDate(finalState.promotionStart);
        dbPatch.promo_end_date = formatSqlDate(finalState.promotionEnd);
        break;
      default:
        break;
    }
  }

  return dbPatch;
}
