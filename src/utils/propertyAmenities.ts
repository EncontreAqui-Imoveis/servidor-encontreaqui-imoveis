export const CANONICAL_PROPERTY_AMENITIES = [
  "POÇO ARTESIANO",
  "MOBILIADA",
  "ELEVADOR",
  "ACADEMIA",
  "CHURRASQUEIRA",
  "SALÃO DE FESTAS",
  "QUADRA",
  "CONDOMÍNIO FECHADO",
  "ACEITA PETS",
  "SISTEMA DE SEGURANÇA/CÂMARA",
  "SAUNA",
] as const;

const CANONICAL_AMENITY_LOOKUP: Record<string, string> = {
  "poco artesanal": "POÇO ARTESIANO",
  "mobiliada": "MOBILIADA",
  "planejados": "PLANEJADOS",
  "elevador": "ELEVADOR",
  "academia": "ACADEMIA",
  "churrasqueira": "CHURRASQUEIRA",
  "salao de festas": "SALÃO DE FESTAS",
  "quadro": "QUADRA",
  "quadra": "QUADRA",
  "condominio fechado": "CONDOMÍNIO FECHADO",
  "aceita pets": "ACEITA PETS",
  "sistema de seguranca/camera": "SISTEMA DE SEGURANÇA/CÂMARA",
  "sistema de seguranca": "SISTEMA DE SEGURANÇA/CÂMARA",
  "sistema de seguranca /camera": "SISTEMA DE SEGURANÇA/CÂMARA",
  "sistema de seguranca / camera": "SISTEMA DE SEGURANÇA/CÂMARA",
  "sistema de seguranca/camara": "SISTEMA DE SEGURANÇA/CÂMARA",
  "sauna": "SAUNA",
};

const AMENITY_ID_TO_CANONICAL: Record<string, string> = {
  "1": "POÇO ARTESIANO",
  "2": "MOBILIADA",
  "3": "PLANEJADOS",
  "4": "ELEVADOR",
  "5": "ACADEMIA",
  "6": "CHURRASQUEIRA",
  "7": "SALÃO DE FESTAS",
  "8": "QUADRA",
  "9": "CONDOMÍNIO FECHADO",
  "10": "ACEITA PETS",
  "11": "SISTEMA DE SEGURANÇA/CÂMARA",
  "12": "SAUNA",
};

function normalizeAmenityInputValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toCanonicalAmenity(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  if (/^-?\d+$/.test(cleaned)) {
    return AMENITY_ID_TO_CANONICAL[cleaned] ?? null;
  }

  const normalized = normalizeAmenityInputValue(cleaned).replace(/[\u2012\u2013\u2014]/g, "-");
  const mapped = CANONICAL_AMENITY_LOOKUP[normalized];
  if (mapped) {
    return mapped;
  }

  for (const canonical of CANONICAL_PROPERTY_AMENITIES) {
    if (normalizeAmenityInputValue(canonical) === normalized) {
      return canonical;
    }
  }

  return null;
}

function parseAmenityInput(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }

  if (typeof value === "object") {
    return [String(value)];
  }

  const text = String(value).trim();
  if (!text) {
    return [];
  }

  if (text.startsWith("[") && text.endsWith("]")) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      return [text];
    }
    return parsed.map((entry) => String(entry));
  }

  if (text.includes(",")) {
    return text
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [text];
}

export function normalizePropertyAmenities(rawAmenities: unknown): string[] {
  const entries = parseAmenityInput(rawAmenities);
  const normalized = new Set<string>();

  for (const entry of entries) {
    const canonical = toCanonicalAmenity(entry);
    if (canonical === null) {
      throw new Error(`Comodidade inválida: ${String(entry)}`);
    }
    normalized.add(canonical);
  }

  return Array.from(normalized);
}
