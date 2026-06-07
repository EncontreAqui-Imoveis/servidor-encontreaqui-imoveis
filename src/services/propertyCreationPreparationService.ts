import { stringOrNull } from "./propertyCreationNormalizationService";

export function hasAnyOwnPayloadField(payload: Record<string, unknown>, fields: string[]): boolean {
  return fields.some((field) => Object.prototype.hasOwnProperty.call(payload, field));
}

export function deriveLegacyAmenityFlagsFromCanonicalAmenities(amenities: string[]): {
  hasWifi: 0 | 1;
  temPiscina: 0 | 1;
  temEnergiaSolar: 0 | 1;
  temAutomacao: 0 | 1;
  temArCondicionado: 0 | 1;
  ehMobiliada: 0 | 1;
} {
  const canonicalAmenities = new Set<string>();
  for (const amenity of amenities) {
    const normalized = String(amenity ?? "").trim();
    if (normalized.length > 0) {
      canonicalAmenities.add(normalized);
    }
  }

  return {
    hasWifi: canonicalAmenities.has("Wi-Fi") ? 1 : 0,
    temPiscina: canonicalAmenities.has("Piscina") ? 1 : 0,
    temEnergiaSolar: canonicalAmenities.has("Energia solar") ? 1 : 0,
    temAutomacao: canonicalAmenities.has("Automação") ? 1 : 0,
    temArCondicionado: canonicalAmenities.has("Ar condicionado") ? 1 : 0,
    ehMobiliada: canonicalAmenities.has("Mobiliada") ? 1 : 0,
  };
}

export function resolvePropertyCreationLocationExtras(params: {
  quadra: unknown;
  lote: unknown;
  semQuadraFlag: boolean;
  semLoteFlag: boolean;
}): {
  effectiveQuadra: string | null;
  effectiveLote: string | null;
} {
  return {
    effectiveQuadra: params.semQuadraFlag ? null : stringOrNull(params.quadra),
    effectiveLote: params.semLoteFlag ? null : stringOrNull(params.lote),
  };
}

export function resolvePropertyCreationCode(code: unknown): string | null {
  const normalized = String(code ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
