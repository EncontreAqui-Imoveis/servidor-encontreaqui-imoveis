export type AddressFields = {
  street: string;
  number: string;
  complement: string | null;
  bairro: string;
  city: string;
  state: string;
  cep: string;
};

export type AddressInput = Partial<Record<keyof AddressFields, unknown>>;

type AddressResult =
  | { ok: true; value: AddressFields }
  | { ok: false; errors: string[] };

const MAX_STREET = 255;
const MAX_NUMBER = 50;
const MAX_COMPLEMENT = 255;
const MAX_BAIRRO = 255;
const MAX_CITY = 100;
const CEP_LENGTH = 8;
const STATE_LENGTH = 2;

function normalizeText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim().replace(/\s+/g, ' ');
  return text.length > 0 ? text : null;
}

function normalizeState(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.toUpperCase().replace(/[^A-Z]/g, '');
  return normalized.length == STATE_LENGTH ? normalized : null;
}

function normalizeNumber(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.replace(/\D/g, '');
  return normalized.length > 0 ? normalized : null;
}

function normalizeCep(value: unknown): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  return digits.length == CEP_LENGTH ? digits : null;
}

function withinLimit(value: string, limit: number): boolean {
  return value.length <= limit;
}

export function sanitizeAddressInput(input: AddressInput): AddressResult {
  const errors: string[] = [];

  const street = normalizeText(input.street);
  if (!street) errors.push('street');
  const number = normalizeNumber(input.number);
  if (!number) errors.push('number');
  const bairro = normalizeText(input.bairro);
  if (!bairro) errors.push('bairro');
  const city = normalizeText(input.city);
  if (!city) errors.push('city');
  const state = normalizeState(input.state);
  if (!state) errors.push('state');
  const cep = normalizeCep(input.cep);
  if (!cep) errors.push('cep');
  const complement = normalizeText(input.complement);

  if (street && !withinLimit(street, MAX_STREET)) errors.push('street');
  if (number && !withinLimit(number, MAX_NUMBER)) errors.push('number');
  if (bairro && !withinLimit(bairro, MAX_BAIRRO)) errors.push('bairro');
  if (city && !withinLimit(city, MAX_CITY)) errors.push('city');
  if (complement && !withinLimit(complement, MAX_COMPLEMENT)) errors.push('complement');

  if (errors.length > 0) {
    return { ok: false, errors: Array.from(new Set(errors)) };
  }

  return {
    ok: true,
    value: {
      street: street!,
      number: number!,
      complement: complement ?? null,
      bairro: bairro!,
      city: city!,
      state: state!,
      cep: cep!,
    },
  };
}
