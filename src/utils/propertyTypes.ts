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
  'Sobrado',
  'Kitnet',
  'Sala comercial',
  'Empresa',
  'Prédio',
] as const;

type PropertyType = (typeof PROPERTY_TYPES)[number];

const LEGACY_TYPE_MAP: Record<string, PropertyType> = {
  propriedaderural: 'Área rural',
  propriedadecomercial: 'Imóvel comercial',
  arearural: 'Área rural',
  areacomercial: 'Área comercial',
  imovelcomercial: 'Imóvel comercial',
  condominiofechado: 'Condomínio Fechado',
  galpao: 'Galpão / Barracão',
  barracao: 'Galpão / Barracão',
  galpaobarracao: 'Galpão / Barracão',
  chacara: 'Chácara',
  coberturapenthouse: 'Cobertura / Penthouse',
  penthouse: 'Cobertura / Penthouse',
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

export const PROPERTY_TYPE_LEGACY_UPDATES: Array<{ from: string; to: string }> = [
  { from: 'Propriedade Rural', to: 'Área rural' },
  { from: 'Propriedade Comercial', to: 'Imóvel comercial' },
];
