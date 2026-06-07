import { normalizePropertyType } from "../utils/propertyTypes";
import { validatePropertyNumericRange } from "./propertyValidationCommon";

import { getAreaUnitMax, type AreaConstruidaUnidade } from "../utils/propertyAreaUnits";

export {
  parseAreaWithUnit,
  parseDecimal,
  resolveRequiredField,
  validateMaxTextLength,
  validatePropertyNumericRange,
} from "./propertyValidationCommon";

type Nullable<T> = T | null;

const PROPERTY_TYPES_REQUIRING_LAND_AREA = new Set([
  "Terreno",
  "Área rural",
  "Rancho",
  "Chácara",
  "Fazenda",
  "Área comercial",
]);

export function resolveValidationFieldFromMessage(message: string): string | undefined {
  const fieldByLabel: Array<{ key: string; field: string }> = [
    { key: "Quartos", field: "bedrooms" },
    { key: "Banheiros", field: "bathrooms" },
    { key: "Garagens", field: "garage_spots" },
    { key: "Área construída", field: "area_construida" },
    { key: "Área do terreno", field: "area_terreno" },
    { key: "Área de construção", field: "area_construida" },
    { key: "Preço base", field: "price" },
    { key: "Preço de venda", field: "price_sale" },
    { key: "Preço de aluguel", field: "price_rent" },
    { key: "Preço promocional de venda", field: "promotion_price" },
    { key: "Preço promocional de aluguel", field: "promotional_rent_price" },
    { key: "Valor de condomínio", field: "valor_condominio" },
    { key: "Valor de IPTU", field: "valor_iptu" },
    { key: "Título", field: "title" },
    { key: "Nome do proprietário", field: "owner_name" },
    { key: "Endereço", field: "address" },
    { key: "Número", field: "numero" },
    { key: "Bairro", field: "bairro" },
    { key: "Complemento", field: "complemento" },
    { key: "Cidade", field: "city" },
    { key: "Quadra", field: "quadra" },
    { key: "Lote", field: "lote" },
    { key: "Código", field: "code" },
  ];
  const normalized = String(message ?? "");
  const entry = fieldByLabel.find((candidate) => normalized.includes(candidate.key));
  return entry?.field;
}

export function validateAreaByInputUnit(
  parsedArea: { valor: Nullable<number>; unidade: AreaConstruidaUnidade; m2: Nullable<number> },
  label: string,
  options: { allowNull: boolean },
): string | null {
  const max = getAreaUnitMax(parsedArea.unidade);
  if (max == null) {
    return null;
  }

  return validatePropertyNumericRange(parsedArea.valor, label, {
    max,
    allowNull: options.allowNull,
  });
}

export function isTerrainAreaRequiredForType(type: unknown): boolean {
  const normalized = normalizePropertyType(type);
  return normalized != null && PROPERTY_TYPES_REQUIRING_LAND_AREA.has(normalized);
}
