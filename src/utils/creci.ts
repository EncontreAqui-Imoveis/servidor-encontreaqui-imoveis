export const CRECI_REGEX = /^\d{4,8}-?[A-Za-z]?$/;

export function normalizeCreci(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim().replace(/\s+/g, '').toUpperCase();
}

export function hasValidCreci(value: unknown): boolean {
  const normalized = normalizeCreci(value);
  return normalized.length <= 8 && CRECI_REGEX.test(normalized);
}
