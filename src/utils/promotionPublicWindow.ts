/**
 * Janela de promoção para vitrine: compara "agora" com início/fim.
 * Datas vêm do MySQL (em geral sem timezone); tratamos como instantes comparáveis.
 * Dono/admin (includeOwnerInfo) não passam por aqui — veem ficha bruta.
 */
function parseInstant(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const s = String(value).trim();
  if (s.length === 0) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function isActivePromotionWindow(
  isPromoted: boolean,
  startRaw: unknown,
  endRaw: unknown
): boolean {
  if (!isPromoted) return false;
  const start = parseInstant(startRaw);
  const end = parseInstant(endRaw);
  const now = Date.now();
  if (start != null && now < start) return false;
  if (end != null && now > end) return false;
  return true;
}

export type PublicPropertyPayload = Record<string, unknown>;

/**
 * Fora da janela, remove efeito de promo na resposta pública (preço de vitrine = normal).
 */
export function stripExpiredPromotionFromPublicPayload<T extends PublicPropertyPayload>(
  payload: T,
  includeOwnerInfo: boolean
): T {
  if (includeOwnerInfo) {
    return payload;
  }
  const isPromoted = Boolean(
    payload.is_promoted === true || payload.is_promoted === 1 || payload.is_promoted === '1'
  );
  if (!isPromoted) {
    return payload;
  }
  const start = payload.promotion_start ?? payload.promo_start_date ?? null;
  const end = payload.promotion_end ?? payload.promo_end_date ?? null;
  if (isActivePromotionWindow(isPromoted, start, end)) {
    return payload;
  }
  return {
    ...payload,
    is_promoted: false,
    promotion_percentage: null,
    promotion_start: null,
    promotion_end: null,
    promo_percentage: null,
    promo_start_date: null,
    promo_end_date: null,
    promoPercentage: null,
    promoStartDate: null,
    promoEndDate: null,
    promotion_price: null,
    promotional_rent_price: null,
    promotional_rent_percentage: null,
    promotionalPrice: null,
    promotionPrice: null,
    promotionalRentPrice: null,
    promotionalRentPercentage: null,
  };
}
