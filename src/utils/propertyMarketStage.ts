export const PROPERTY_MARKET_STAGES = ['STANDARD', 'LAUNCH'] as const;

export type PropertyMarketStage = (typeof PROPERTY_MARKET_STAGES)[number];

export function normalizePropertyMarketStage(value: unknown): PropertyMarketStage | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'STANDARD';
  }

  const normalized = String(value).trim().toUpperCase();
  if (normalized === 'STANDARD') return 'STANDARD';
  if (normalized === 'LAUNCH' || normalized === 'LANCAMENTO' || normalized === 'LANÇAMENTO') {
    return 'LAUNCH';
  }
  return null;
}

export function propertyPurposeSupportsSale(purpose: unknown): boolean {
  return String(purpose ?? '').trim().toLocaleLowerCase('pt-BR').includes('vend');
}

export function canUsePropertyMarketStage(
  stage: PropertyMarketStage,
  purpose: unknown,
): boolean {
  return stage !== 'LAUNCH' || propertyPurposeSupportsSale(purpose);
}
