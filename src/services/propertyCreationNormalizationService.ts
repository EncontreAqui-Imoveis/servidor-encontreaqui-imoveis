import { isOptionalBairroPropertyType } from "../utils/propertyTypes";
import { parsePrice as sharedParsePrice } from "./propertyUpdateValidationService";

type Nullable<T> = T | null;

export function normalizePropertyDescription(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function hasValidPropertyDescription(value: unknown, maxLength: number): boolean {
  const normalized = normalizePropertyDescription(String(value ?? ""));
  return normalized.length > 0 && normalized.length <= maxLength;
}

export function normalizePurpose(value: unknown): Nullable<string> {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return null;
  if (normalized === "venda") return "Venda";
  if (normalized === "aluguel") return "Aluguel";
  if (normalized === "vendaealuguel" || normalized === "vendaaluguel") {
    return "Venda e Aluguel";
  }
  return null;
}

export function parseOptionalPrice(value: unknown): Nullable<number> {
  if (value == null || value === "") {
    return null;
  }
  return sharedParsePrice(value);
}

export function parsePrice(value: unknown): number {
  return sharedParsePrice(value);
}

export function normalizeNumericCountField(
  value: unknown,
  options: { label: string; required?: boolean; hasField?: boolean }
): number | null {
  if (value == null || value === "") {
    if (options.required && options.hasField) {
      throw new Error(`${options.label} inválido.`);
    }
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      if (options.required && options.hasField) {
        throw new Error(`${options.label} inválido.`);
      }
      return null;
    }

    const normalized = trimmed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
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
    if (isSemValue) {
      return 0;
    }
  }

  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${options.label} deve ser no mínimo 0.`);
  }
  return parsed;
}

export function parseBoolean(value: unknown): 0 | 1 {
  if (value === true || value === 1 || value === "1" || value === "true") {
    return 1;
  }
  return 0;
}

export function parsePromotionPercentage(value: unknown): Nullable<number> {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Percentual promocional inválido.");
  }
  return parsed;
}

export function parsePromotionDateTime(value: unknown): Nullable<string> {
  if (value == null || value === "") {
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;
  return text;
}

export function parsePromotionDate(value: unknown): Nullable<string> {
  const text = parsePromotionDateTime(value);
  if (!text) return null;
  return text.slice(0, 10);
}

export function stringOrNull(value: unknown): Nullable<string> {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeAddressNumberForPersistence(
  value: unknown,
  semNumeroFlag: boolean | 0 | 1,
): string | null {
  if (semNumeroFlag === true || semNumeroFlag === 1) {
    return null;
  }
  const normalized = stringOrNull(value);
  if (!normalized) return null;
  return normalized;
}

export function normalizeCepForPersistence(
  value: unknown,
  semCepFlag: boolean | 0 | 1,
): string | null {
  if (semCepFlag === true || semCepFlag === 1) {
    return null;
  }

  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function validateRequiredBairro(bairro: unknown, propertyType: string): string | null {
  if (!isOptionalBairroPropertyType(propertyType)) {
    return stringOrNull(bairro) ? null : "Bairro é obrigatório.";
  }
  return null;
}
