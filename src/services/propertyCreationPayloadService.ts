import type { AreaConstruidaUnidade } from "../utils/propertyAreaUnits";

function normalizeCepForPersistence(value: unknown, semCepFlag: boolean | 0 | 1): string | null {
  if (semCepFlag === true || semCepFlag === 1) {
    return null;
  }

  const normalized = String(value ?? "").replace(/\D/g, "");
  return normalized.length > 0 ? normalized : null;
}

export function buildPropertyCreationInsertValues(payload: {
  brokerId: number | null;
  ownerId: number | null;
  title: unknown;
  normalizedDescription: string;
  normalizedType: string;
  normalizedPurpose: string;
  promotionFlag: 0 | 1;
  promotionPercentage: number | null;
  promotionStart: string | null;
  promotionEnd: string | null;
  promotionStartDate: string | null;
  promotionEndDate: string | null;
  numericPrice: number;
  numericPriceSale: number | null;
  numericPriceRent: number | null;
  numericPromotionPrice: number | null;
  numericPromotionalRentPrice: number | null;
  promotionalRentPercentage: number | null;
  propertyCode: string;
  ownerName: unknown;
  ownerPhone: unknown;
  address: unknown;
  effectiveQuadra: string | null;
  semQuadraFlag: boolean;
  effectiveLote: string | null;
  semLoteFlag: boolean;
  numeroNormalizado: string | null;
  bairro: unknown;
  complemento: unknown;
  city: unknown;
  state: unknown;
  cep: unknown;
  semCepFlag: boolean;
  numericBedrooms: number | null;
  numericBathrooms: number | null;
  areaConstruida: { valor: number | null; unidade: AreaConstruidaUnidade; m2: number | null };
  areaTerreno: { valor: number | null; unidade: AreaConstruidaUnidade; m2: number | null };
  numericGarageSpots: number | null;
  normalizedAmenities: string[];
  hasWifiFlag: 0 | 1;
  temPiscinaFlag: 0 | 1;
  temEnergiaSolarFlag: 0 | 1;
  temAutomacaoFlag: 0 | 1;
  temArCondicionadoFlag: 0 | 1;
  ehMobiliadaFlag: 0 | 1;
  numericValorCondominio: number | null;
  numericValorIptu: number | null;
  videoUrl: string | null;
  publicId: string;
  publicCode: string;
}): unknown[] {
  return [
    payload.brokerId,
    payload.ownerId,
    payload.title,
    payload.normalizedDescription,
    payload.normalizedType,
    payload.normalizedPurpose,
    'pending_approval',
    payload.promotionFlag,
    payload.promotionPercentage,
    payload.promotionStart,
    payload.promotionEnd,
    payload.promotionPercentage,
    payload.promotionStartDate,
    payload.promotionEndDate,
    payload.numericPrice,
    payload.numericPriceSale,
    payload.numericPriceRent,
    payload.numericPromotionPrice,
    payload.numericPromotionalRentPrice,
    payload.promotionalRentPercentage,
    payload.propertyCode,
    String(payload.ownerName ?? '').trim() || null,
    String(payload.ownerPhone ?? '').replace(/\D/g, '') || null,
    payload.address,
    payload.effectiveQuadra,
    payload.semQuadraFlag,
    payload.effectiveLote,
    payload.semLoteFlag,
    payload.numeroNormalizado,
    String(payload.bairro ?? '').trim() || null,
    String(payload.complemento ?? '').trim() || null,
    payload.city,
    payload.state,
    normalizeCepForPersistence(payload.cep, payload.semCepFlag),
    payload.semCepFlag,
    payload.numericBedrooms,
    payload.numericBathrooms,
    payload.areaConstruida.m2,
    payload.areaConstruida.unidade,
    payload.areaTerreno.m2,
    payload.areaConstruida.valor,
    payload.areaConstruida.m2,
    payload.areaTerreno.valor,
    payload.areaTerreno.unidade,
    payload.areaTerreno.m2,
    payload.numericGarageSpots,
    payload.normalizedAmenities.length > 0 ? JSON.stringify(payload.normalizedAmenities) : null,
    payload.hasWifiFlag,
    payload.temPiscinaFlag,
    payload.temEnergiaSolarFlag,
    payload.temAutomacaoFlag,
    payload.temArCondicionadoFlag,
    payload.ehMobiliadaFlag,
    payload.numericValorCondominio,
    payload.numericValorIptu,
    payload.videoUrl,
    payload.publicId,
    payload.publicCode,
  ];
}
