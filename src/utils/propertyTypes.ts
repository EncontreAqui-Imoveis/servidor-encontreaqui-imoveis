export const PROPERTY_TYPES = [
  'Casa',
  'Apartamento',
  'Terreno',
  'Flat',
  'Condomínio Fechado',
  'Área rural',
  'Rancho',
  'Galpão / Barracão',
  'Chácara',
  'Imóvel comercial',
  'Área comercial',
  'Cobertura / Penthouse',
  'Cobertura',
  'Sobrado',
  'Kitnet',
  'Sala comercial',
  'Sala Comercial',
  'Loja',
  'Fazenda',
  'Galpão',
  'Empresa',
  'Prédio',
] as const;

export const OPTIONAL_BAIRRO_PROPERTY_TYPES = [
  'Área rural',
  'Chácara',
  'Rancho',
] as const;

type PropertyType = (typeof PROPERTY_TYPES)[number];

const LEGACY_TYPE_MAP: Record<string, PropertyType> = {
  propriedaderural: 'Área rural',
  propriedadecomercial: 'Imóvel comercial',
  arearural: 'Área rural',
  areacomercial: 'Área comercial',
  imovelcomercial: 'Imóvel comercial',
  condominiofechado: 'Condomínio Fechado',
  galpao: 'Galpão',
  barracao: 'Galpão / Barracão',
  galpaobarracao: 'Galpão / Barracão',
  chacara: 'Chácara',
  coberturapenthouse: 'Cobertura / Penthouse',
  penthouse: 'Cobertura / Penthouse',
  cobertura: 'Cobertura',
  salacomercial: 'Sala Comercial',
  loja: 'Loja',
  fazenda: 'Fazenda',
  predio: 'Prédio',
};

function normalizeTypeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
}

export function normalizePropertyType(value: unknown): PropertyType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = PROPERTY_TYPES.find((type) => type === trimmed);
  if (direct) {
    return direct;
  }

  const key = normalizeTypeKey(trimmed);
  if (LEGACY_TYPE_MAP[key]) {
    return LEGACY_TYPE_MAP[key];
  }

  const normalizedDirect = PROPERTY_TYPES.find(
    (type) => normalizeTypeKey(type) === key
  );
  return normalizedDirect ?? null;
}

export function isOptionalBairroPropertyType(value: unknown): boolean {
  const normalized = normalizePropertyType(value);
  return normalized != null && OPTIONAL_BAIRRO_PROPERTY_TYPES.includes(normalized as (typeof OPTIONAL_BAIRRO_PROPERTY_TYPES)[number]);
}

export const PROPERTY_TYPE_LEGACY_UPDATES: Array<{ from: string; to: string }> = [
  { from: 'Propriedade Rural', to: 'Área rural' },
  { from: 'Propriedade Comercial', to: 'Imóvel comercial' },
];
