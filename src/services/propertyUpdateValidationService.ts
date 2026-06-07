import { isOptionalBairroPropertyType } from "../utils/propertyTypes";
import { getAreaUnitMax } from "../utils/propertyAreaUnits";
import {
  parseLocalizedDecimal,
  normalizePropertyDescription,
  type ParsedAreaValues,
  validatePropertyNumericRange,
} from "./propertyValidationCommon";

export {
  calculateCommissionAmount,
  normalizeCepForPersistence,
  normalizeNumericCountField,
  normalizePropertyDescription,
  normalizeRecurrenceInterval,
  parseAreaWithUnit,
  parseDecimal,
  parsePromotionDate,
  parsePromotionDateTime,
  parsePromotionPercentage,
  resolveDealAmount,
  resolveRequiredField,
  validateMaxTextLength,
  validatePropertyNumericRange,
} from "./propertyValidationCommon";

type Nullable<T> = T | null;

const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_PROPERTY_AREA = 99999999.99;

type PropertyStatus = "pending_approval" | "approved" | "rejected" | "rented" | "sold";
type DealType = "sale" | "rent";

const STATUS_MAP: Record<string, PropertyStatus> = {
  pendingapproval: "pending_approval",
  pendente: "pending_approval",
  pending: "pending_approval",
  pendenteaprovacao: "pending_approval",
  aprovado: "approved",
  approved: "approved",
  aprovada: "approved",
  rejected: "rejected",
  rejeitado: "rejected",
  rejeitada: "rejected",
  rented: "rented",
  alugado: "rented",
  alugada: "rented",
  locado: "rented",
  locada: "rented",
  sold: "sold",
  vendido: "sold",
  vendida: "sold",
};

const ALLOWED_STATUSES = new Set<PropertyStatus>(["pending_approval", "approved", "rejected", "rented", "sold"]);
const PURPOSE_MAP: Record<string, string> = {
  venda: "Venda",
  comprar: "Venda",
  aluguel: "Aluguel",
  vendaealuguel: "Venda e Aluguel",
  vendaaluguel: "Venda e Aluguel",
};
const ALLOWED_PURPOSES = new Set(["Venda", "Aluguel", "Venda e Aluguel"]);
const STATUS_TO_DEAL: Partial<Record<PropertyStatus, DealType>> = { sold: "sale", rented: "rent" };

export function resolveValidationFieldFromMessage(message: string): string | undefined {
  const normalized = message.toLowerCase();
  if (normalized.includes("titulo")) return "title";
  if (normalized.includes("descricao")) return "description";
  if (normalized.includes("preco de venda")) return "price_sale";
  if (normalized.includes("preco de aluguel")) return "price_rent";
  if (normalized.includes("preco promocional de venda")) return "promotion_price";
  if (normalized.includes("preco promocional de aluguel")) return "promotional_rent_price";
  if (normalized.includes("bairro")) return "bairro";
  if (normalized.includes("cep")) return "cep";
  if (normalized.includes("numero")) return "numero";
  if (normalized.includes("area construída")) return "area_construida";
  if (normalized.includes("area do terreno")) return "area_terreno";
  if (normalized.includes("garagem")) return "garage_spots";
  if (normalized.includes("quarto")) return "bedrooms";
  if (normalized.includes("banheiro")) return "bathrooms";
  if (normalized.includes("condominio")) return "valor_condominio";
  if (normalized.includes("iptu")) return "valor_iptu";
  if (normalized.includes("telefone")) return "owner_phone";
  if (normalized.includes("status")) return "status";
  if (normalized.includes("finalidade")) return "purpose";
  if (normalized.includes("tipo")) return "type";
  return undefined;
}

export function normalizeStatus(value: unknown): Nullable<PropertyStatus> {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFD").replace(/[^\p{L}0-9]/gu, "").toLowerCase();
  const status = STATUS_MAP[normalized];
  return status && ALLOWED_STATUSES.has(status) ? status : null;
}

export function normalizePurpose(value: unknown): Nullable<string> {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFD").replace(/[^\p{L}0-9]/gu, "").toLowerCase();
  const mapped = PURPOSE_MAP[normalized];
  return mapped && ALLOWED_PURPOSES.has(mapped) ? mapped : null;
}

export function parsePrice(value: unknown): number {
  const parsed = parseLocalizedDecimal(value);
  if (parsed === null || parsed < 0) throw new Error("Preço inválido.");
  return parsed;
}

export function parseOptionalPrice(value: unknown): Nullable<number> {
  if (value === undefined || value === null || value === "") return null;
  return parsePrice(value);
}

export function parseBoolean(value: unknown): 0 | 1 {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value === 0 ? 0 : 1;
  if (typeof value === "string") return ["1", "true", "yes", "sim", "on"].includes(value.trim().toLowerCase()) ? 1 : 0;
  return 0;
}

export function toBoolean(value: unknown): boolean {
  return value === 1 || value === "1" || value === true;
}

export function stringOrNull(value: unknown): Nullable<string> {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

export function hasValidPropertyDescription(value: unknown): boolean {
  return (
    typeof value === "string" &&
    normalizePropertyDescription(value).length > 0 &&
    normalizePropertyDescription(value).length <= MAX_PROPERTY_DESCRIPTION_LENGTH
  );
}

export function resolveDealTypeFromStatus(status: Nullable<PropertyStatus>): Nullable<DealType> {
  return status ? STATUS_TO_DEAL[status] ?? null : null;
}

export function validateRequiredBairro(bairro: unknown, propertyType: unknown): string | null {
  if (isOptionalBairroPropertyType(propertyType)) return null;
  return stringOrNull(bairro) ? null : "Bairro é obrigatório.";
}

export function validateAreaByInputUnit(
  parsedArea: ParsedAreaValues,
  label: string,
  options: { allowNull: boolean },
): string | null {
  const max = parsedArea.unidade === "m2" ? MAX_PROPERTY_AREA : getAreaUnitMax(parsedArea.unidade);
  if (max == null) return null;
  return validatePropertyNumericRange(parsedArea.valor, label, { max, allowNull: options.allowNull });
}
