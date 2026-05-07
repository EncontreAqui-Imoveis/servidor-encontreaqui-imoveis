const CANONICAL_CAMERA_AMENITY = "SISTEMA DE SEGURANÇA/CÂMERA";

export const CANONICAL_PROPERTY_AMENITIES = [
  "Wi-Fi",
  "Piscina",
  "Energia solar",
  "Automação",
  "Ar condicionado",
  "Poço artesiano",
  "Mobiliada",
  "Elevador",
  "Academia",
  "Churrasqueira",
  "Salão de festas",
  "Quadra",
  "Condomínio fechado",
  "Aceita pets",
  CANONICAL_CAMERA_AMENITY,
  "Sauna",
] as const;

const CANONICAL_AMENITY_LOOKUP: Record<string, string> = {
  "wifi": "Wi-Fi",
  "wi-fi": "Wi-Fi",
  "wi fi": "Wi-Fi",
  "piscina": "Piscina",
  "energia solar": "Energia solar",
  "automacao": "Automação",
  "automação": "Automação",
  "ar condicionado": "Ar condicionado",
  "ar-condicionado": "Ar condicionado",
  "condicionado": "Ar condicionado",
  "poco artesanal": "Poço artesiano",
  "poço artesanal": "Poço artesiano",
  "poço artesiano": "Poço artesiano",
  "mobiliada": "Mobiliada",
  "elevador": "Elevador",
  "academia": "Academia",
  "churrasqueira": "Churrasqueira",
  "salao de festas": "Salão de festas",
  "quadro": "Quadra",
  "quadra": "Quadra",
  "condominio fechado": "Condomínio fechado",
  "condomínio fechado": "Condomínio fechado",
  "aceita pets": "Aceita pets",
  "sistema de seguranca": CANONICAL_CAMERA_AMENITY,
  "sistema de seguranca/camera": CANONICAL_CAMERA_AMENITY,
  "sistema de seguranca/camara": CANONICAL_CAMERA_AMENITY,
  "camera": CANONICAL_CAMERA_AMENITY,
  "camara": CANONICAL_CAMERA_AMENITY,
  "sauna": "Sauna",
};

const AMENITY_ID_TO_CANONICAL: Record<string, string> = {
  "1": "Poço artesiano",
  "2": "Mobiliada",
  "4": "Elevador",
  "5": "Academia",
  "6": "Churrasqueira",
  "7": "Salão de festas",
  "8": "Quadra",
  "9": "Condomínio fechado",
  "10": "Aceita pets",
  "11": CANONICAL_CAMERA_AMENITY,
  "12": "Sauna",
};

function normalizeAmenityInputValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function toCanonicalAmenity(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  if (/^-?\d+$/.test(cleaned)) {
    return AMENITY_ID_TO_CANONICAL[cleaned] ?? null;
  }

  const normalized = normalizeAmenityInputValue(cleaned)
    .replace(/[\u2012\u2013\u2014]/g, "-")
    .replace(/\s*\/\s*/g, "/");
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
    if (normalizeAmenityInputValue(entry) === "planejados") {
      throw new Error(`Comodidade inválida: ${String(entry)}`);
    }
    const canonical = toCanonicalAmenity(entry);
    if (canonical === null) {
      throw new Error(`Comodidade inválida: ${String(entry)}`);
    }
    normalized.add(canonical);
  }

  return Array.from(normalized);
}
