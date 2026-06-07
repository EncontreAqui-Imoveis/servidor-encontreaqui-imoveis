import { areaInputToSquareMeters, parseAreaUnidade, type AreaConstruidaUnidade } from "../utils/propertyAreaUnits";

type Nullable<T> = T | null;

export type ParsedAreaValues = {
  valor: Nullable<number>;
  unidade: AreaConstruidaUnidade;
  m2: Nullable<number>;
};

export const MAX_GENERIC_PROPERTY_TEXT_LENGTH = 120;
export const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
export const MAX_PROPERTY_AREA = 99999999.99;

type RecurrenceInterval = "none" | "weekly" | "monthly" | "yearly";

const RECURRENCE_INTERVALS = new Set<RecurrenceInterval>(["none", "weekly", "monthly", "yearly"]);
export function resolveRequiredField(payload: Record<string, unknown>): string {
  if (!payload.title) return "title";
  if (!payload.description) return "description";
  if (!payload.type) return "type";
  if (!payload.purpose) return "purpose";
  if (!payload.address) return "address";
  if (!payload.city) return "city";
  if (!payload.state) return "state";
  return "title";
}

export function validateMaxTextLength(
  value: unknown,
  label: string,
  maxLength: number = MAX_GENERIC_PROPERTY_TEXT_LENGTH,
): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    return `${label} deve ter no máximo ${maxLength} caracteres.`;
  }
  return null;
}

export function validatePropertyNumericRange(
  value: number | null,
  label: string,
  options: { max: number; allowNull?: boolean },
): string | null {
  if (value == null) {
    return options.allowNull ? null : `${label} inválido.`;
  }
  if (value < 0) {
    return `${label} deve ser no mínimo 0.`;
  }
  if (value > options.max) {
    return `${label} deve ser no máximo ${options.max}.`;
  }
  return null;
}

export function normalizePropertyDescription(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function parseLocalizedDecimal(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/R\$\s*/gi, "").replace(/[^\d.,+-]/g, "");
  if (!normalized) {
    return null;
  }

  const hasMinus = normalized.startsWith("-");
  const unsigned = hasMinus || normalized.startsWith("+") ? normalized.slice(1) : normalized;
  const hasComma = unsigned.includes(",");
  const hasDot = unsigned.includes(".");

  let numericLike = unsigned;
  if (hasComma && hasDot) {
    const commaIndex = unsigned.lastIndexOf(",");
    const dotIndex = unsigned.lastIndexOf(".");
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    numericLike = unsigned
      .split(thousandsSeparator)
      .join("")
      .replace(decimalSeparator, ".");
  } else if (hasComma) {
    const commaIndex = unsigned.lastIndexOf(",");
    const decimalPart = unsigned.slice(commaIndex + 1);
    if (decimalPart.length <= 2) {
      numericLike = `${unsigned.slice(0, commaIndex)}.${decimalPart}`;
    } else {
      numericLike = unsigned.split(",").join("");
    }
  }

  const parsed = Number(`${hasMinus ? "-" : ""}${numericLike}`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDecimal(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = parseLocalizedDecimal(value);
  if (parsed === null || !Number.isFinite(parsed)) {
    throw new Error("Valor numérico inválido.");
  }
  return parsed;
}

export function parsePrice(value: unknown): number {
  const parsed = parseLocalizedDecimal(value);
  if (parsed === null || parsed < 0) {
    throw new Error("Preço inválido.");
  }
  return parsed;
}

export function parseOptionalPrice(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parsePrice(value);
}

export function parseAreaWithUnit({
  value,
  unidade,
  label,
}: {
  value: unknown;
  unidade: unknown;
  label: string;
}): ParsedAreaValues {
  const parsedValor = parseDecimal(value);
  const areaUnidade = parseAreaUnidade(unidade);

  if (parsedValor == null) {
    return { valor: null, unidade: areaUnidade, m2: null };
  }

  if (parsedValor < 0) {
    throw new Error(`${label} não pode ser negativo.`);
  }

  const converted = areaInputToSquareMeters(parsedValor, areaUnidade);
  if (Number.isNaN(converted)) {
    throw new Error(`${label} inválida.`);
  }

  return {
    valor: parsedValor,
    unidade: areaUnidade,
    m2: Number(converted.toFixed(2)),
  };
}

export function validateAreaByInputUnit(
  parsedArea: ParsedAreaValues,
  label: string,
  options: { allowNull: boolean },
): string | null {
  const max = parsedArea.unidade === "m2" ? MAX_PROPERTY_AREA : null;
  if (max == null) {
    return null;
  }

  return validatePropertyNumericRange(parsedArea.valor, label, {
    max,
    allowNull: options.allowNull,
  });
}

export function normalizeNumericCountField(
  value: unknown,
  options: { label: string; required?: boolean; hasField: boolean },
): Nullable<number> {
  const { label, required = false, hasField } = options;
  if (value === undefined || value === null) {
    return hasField && required ? 0 : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return hasField ? 0 : null;
    const normalized = trimmed.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const compacted = normalized.replace(/\s+/g, " ");
    const hasDigits = /\d/.test(normalized);
    const isSemValue =
      compacted === "s/n" ||
      compacted === "sn" ||
      compacted === "sem" ||
      compacted === "nenhum" ||
      compacted === "nao" ||
      compacted === "não" ||
      compacted === "zero" ||
      (/\bsem\b/.test(normalized) && !hasDigits) ||
      (/\bnenhum\b/.test(normalized) && !hasDigits) ||
      (/\bnao\b/.test(normalized) && !hasDigits) ||
      (/\bnão\b/.test(normalized) && !hasDigits) ||
      (/\bzero\b/.test(normalized) && !hasDigits);
    if (isSemValue) return 0;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new Error(`${label} inválido.`);
  if (parsed < 0) throw new Error(`${label} deve ser no mínimo 0.`);
  return parsed;
}

export function parsePromotionPercentage(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error("Percentual de promocao invalido. Use valor entre 0 e 100.");
  }
  return Number(parsed.toFixed(2));
}

export function parsePromotionDateTime(value: unknown): Nullable<string> {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("Data de promocao invalida.");
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

export function parsePromotionDate(value: unknown): Nullable<string> {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("Data de promocao invalida.");
  return parsed.toISOString().slice(0, 10);
}

export function normalizeCepForPersistence(value: unknown, semCepFlag: 0 | 1): string | null {
  if (semCepFlag === 1) return null;
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function normalizeRecurrenceInterval(value: unknown): Nullable<RecurrenceInterval> {
  if (value === undefined || value === null || value === "" || typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as RecurrenceInterval;
  return RECURRENCE_INTERVALS.has(normalized) ? normalized : null;
}

export function calculateCommissionAmount(amount: number, rate: number): number {
  return Number((amount * (rate / 100)).toFixed(2));
}

export function resolveDealAmount(value: unknown, fallback: number): number {
  return value === undefined || value === null || value === "" ? fallback : parsePrice(value);
}
