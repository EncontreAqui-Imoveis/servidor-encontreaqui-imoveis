export type AddressFields = {
  street: string;
  number: string;
  complement: string | null;
  bairro: string;
  city: string;
  state: string;
  cep: string | null;
};

export type AddressInput = Partial<Record<keyof AddressFields, unknown>> & {
  withoutNumber?: unknown;
  without_number?: unknown;
};

type AddressResult =
  | { ok: true; value: AddressFields }
  | { ok: false; errors: string[] };

type PartialAddressResult =
  | { ok: true; value: Partial<AddressFields> }
  | { ok: false; errors: string[] };

const MAX_STREET = 255;
const MAX_NUMBER = 50;
const MAX_COMPLEMENT = 255;
const MAX_BAIRRO = 255;
const MAX_CITY = 100;
const CEP_LENGTH = 8;
const STATE_LENGTH = 2;
const WITHOUT_NUMBER_VALUE = 'S/N';

type AddressNormalizeOptions = {
  requireCep?: boolean;
};

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

function normalizeBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'sim', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'nao', 'não', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return null;
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

export function sanitizeAddressInput(
  input: AddressInput,
  options: AddressNormalizeOptions = {},
): AddressResult {
  const errors: string[] = [];
  const hasWithoutNumberField =
    'withoutNumber' in input || 'without_number' in input;
  const withoutNumber = normalizeBoolean(
    input.withoutNumber ?? input.without_number
  );

  if (hasWithoutNumberField && withoutNumber === null) {
    errors.push('without_number');
  }

  const street = normalizeText(input.street);
  if (!street) errors.push('street');
  const number =
    withoutNumber === true ? WITHOUT_NUMBER_VALUE : normalizeNumber(input.number);
  if (!number) errors.push('number');
  const bairro = normalizeText(input.bairro);
  if (!bairro) errors.push('bairro');
  const city = normalizeText(input.city);
  if (!city) errors.push('city');
  const state = normalizeState(input.state);
  if (!state) errors.push('state');
  const cep = normalizeCep(input.cep);
  if (options.requireCep !== false) {
    if (!cep) {
      errors.push('cep');
    }
  } else if (input.cep !== undefined && input.cep !== null && !cep) {
    errors.push('cep');
  }
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
      cep: cep ?? null,
    },
  };
}

export function sanitizePartialAddressInput(input: AddressInput): PartialAddressResult {
  const errors: string[] = [];
  const value: Partial<AddressFields> = {};
  const hasWithoutNumberField =
    'withoutNumber' in input || 'without_number' in input;
  const withoutNumber = normalizeBoolean(
    input.withoutNumber ?? input.without_number
  );

  if (hasWithoutNumberField && withoutNumber === null) {
    errors.push('without_number');
  }

  if (hasWithoutNumberField && withoutNumber === true) {
    value.number = WITHOUT_NUMBER_VALUE;
  }

  if ('street' in input) {
    const street = normalizeText(input.street);
    if (!street || !withinLimit(street, MAX_STREET)) {
      errors.push('street');
    } else {
      value.street = street;
    }
  }

  if ('number' in input) {
    if (!(hasWithoutNumberField && withoutNumber === true)) {
      const number = normalizeNumber(input.number);
      if (!number || !withinLimit(number, MAX_NUMBER)) {
        errors.push('number');
      } else {
        value.number = number;
      }
    }
  }

  if (
    hasWithoutNumberField &&
    withoutNumber === false &&
    !('number' in input)
  ) {
    errors.push('number');
  }

  if ('bairro' in input) {
    const bairro = normalizeText(input.bairro);
    if (!bairro || !withinLimit(bairro, MAX_BAIRRO)) {
      errors.push('bairro');
    } else {
      value.bairro = bairro;
    }
  }

  if ('city' in input) {
    const city = normalizeText(input.city);
    if (!city || !withinLimit(city, MAX_CITY)) {
      errors.push('city');
    } else {
      value.city = city;
    }
  }

  if ('state' in input) {
    const state = normalizeState(input.state);
    if (!state) {
      errors.push('state');
    } else {
      value.state = state;
    }
  }

  if ('cep' in input) {
    const cep = normalizeCep(input.cep);
    if (!cep) {
      errors.push('cep');
    } else {
      value.cep = cep;
    }
  }

  if ('complement' in input) {
    const complement = normalizeText(input.complement);
    if (complement && !withinLimit(complement, MAX_COMPLEMENT)) {
      errors.push('complement');
    } else {
      value.complement = complement ?? null;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors: Array.from(new Set(errors)) };
  }

  return { ok: true, value };
}
