export const CRECI_REGEX = /^\d{4,6}-?[A-Za-z]?$/;

export function normalizeCreci(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim().replace(/\s+/g, '').toUpperCase();
}

export function hasValidCreci(value: unknown): boolean {
  const normalized = normalizeCreci(value);
  return CRECI_REGEX.test(normalized);
}
