/** Converte valor informado pelo usuário para metros quadrados (armazenamento canônico). */
export type AreaConstruidaUnidade = 'm2' | 'alqueire' | 'hectare';

const M2_PER_HECTARE = 10_000;
/** Alqueire goiano (48.400 m²) — padrão adotado no produto. */
const M2_PER_ALQUEIRE = 48_400;

export function normalizeAreaUnidade(raw: string | null | undefined): AreaConstruidaUnidade {
  const u = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (u === 'alqueire' || u === 'alq') return 'alqueire';
  if (u === 'hectare' || u === 'ha') return 'hectare';
  return 'm2';
}

export function areaInputToSquareMeters(
  value: number,
  unidade: AreaConstruidaUnidade,
): number {
  if (!Number.isFinite(value) || value < 0) {
    return Number.NaN;
  }
  switch (unidade) {
    case 'm2':
      return value;
    case 'hectare':
      return value * M2_PER_HECTARE;
    case 'alqueire':
      return value * M2_PER_ALQUEIRE;
    default:
      return value;
  }
}
