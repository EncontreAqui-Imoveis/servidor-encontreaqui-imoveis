import { Request, Response } from "express";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import AuthRequest from "../middlewares/auth";
import { getRequestId } from "../middlewares/requestContext";
import {
  runPropertyQuery,
  type PropertyQueryExecutor,
} from "../services/propertyPersistenceService";
import { type AreaConstruidaUnidade } from "../utils/propertyAreaUnits";
import { normalizePropertyAmenities } from "../utils/propertyAmenities";
import { normalizePropertyType } from "../utils/propertyTypes";
import {
  allocateNextPropertyCode,
  allocatePublicPropertyIdentifiers,
  PUBLIC_PROPERTY_CODE_REGEX,
} from "../utils/propertyCode";
import {
  hasValidPropertyDescription,
  normalizeAddressNumberForPersistence,
  normalizeCepForPersistence,
  normalizeNumericCountField,
  normalizePropertyDescription,
  normalizePurpose,
  parseBoolean,
  parseOptionalPrice,
  parsePrice,
  parsePromotionDate,
  parsePromotionDateTime,
  parsePromotionPercentage,
  stringOrNull,
  validateRequiredBairro,
} from "./propertyCreationNormalizationService";
import {
  deriveLegacyAmenityFlagsFromCanonicalAmenities,
  hasAnyOwnPayloadField,
  resolvePropertyCreationCode,
  resolvePropertyCreationLocationExtras,
} from "./propertyCreationPreparationService";
import {
  isTerrainAreaRequiredForType,
  parseAreaWithUnit,
  parseDecimal,
  resolveRequiredField,
  resolveValidationFieldFromMessage,
  validateAreaByInputUnit,
  validateMaxTextLength,
  validatePropertyNumericRange,
} from "./propertyCreationValidationService";
import {
  persistPropertyImages,
  uploadPropertyMedia,
} from "./propertyMediaService";
import { buildPropertyCreationInsertValues } from "./propertyCreationPayloadService";
import { runPropertyCreationPostPersistEffects } from "./propertyCreationPostPersistService";

type PropertyStatus = "pending_approval" | "approved" | "rejected" | "rented" | "sold";
type DealType = "sale" | "rent";
type RecurrenceInterval = "none" | "weekly" | "monthly" | "yearly";

const MAX_IMAGES_PER_PROPERTY = 20;
const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_PROPERTY_COUNT = 99;
const MAX_PROPERTY_PRICE = 9999999999.99;
const MAX_PROPERTY_FEE = 99999999.99;
const PUBLIC_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROPERTY_ERROR_CODES = {
  AMENITY_PARSE_ERROR: "PROPERTY_AMENITY_INVALID",
  REQUIRED_FIELDS: "PROPERTY_REQUIRED_FIELDS",
  DESCRIPTION_LENGTH_INVALID: "PROPERTY_DESCRIPTION_INVALID",
  INVALID_TYPE: "PROPERTY_TYPE_INVALID",
  INVALID_PURPOSE: "PROPERTY_PURPOSE_INVALID",
  REQUIRED_BAIRRO: "PROPERTY_BAIRRO_REQUIRED",
  TEXT_VALIDATION_FAILED: "PROPERTY_FIELD_VALIDATION_FAILED",
  INVALID_OWNER_PHONE: "PROPERTY_OWNER_PHONE_INVALID",
  PROMOTION_PARSE_ERROR: "PROPERTY_PROMOTION_PARSE_FAILED",
  PRICE_INVALID: "PROPERTY_PRICE_INVALID",
  PROMOTION_PRICE_INVALID: "PROPERTY_PROMOTION_PRICE_INVALID",
  PRICE_MISSING_FOR_PURPOSE: "PROPERTY_PRICE_REQUIRED",
  NUMERIC_PARSE_ERROR: "PROPERTY_NUMERIC_PARSE_ERROR",
  NUMERIC_RANGE_ERROR: "PROPERTY_NUMERIC_RANGE_EXCEEDED",
  NUMERIC_RANGE_MISMATCH: "PROPERTY_NUMERIC_RANGE_INVALID",
  AREA_RELATION_ERROR: "PROPERTY_AREA_RELATION_INVALID",
  IMAGE_REQUIRED: "PROPERTY_IMAGES_REQUIRED",
  IMAGE_LIMIT_EXCEEDED: "PROPERTY_IMAGES_LIMIT_EXCEEDED",
  IMAGE_UPLOAD_TOO_LARGE: "PROPERTY_IMAGE_TOO_LARGE",
  CODE_ALREADY_EXISTS: "PROPERTY_CODE_ALREADY_EXISTS",
  PENDING_APPROVAL_BLOCKED: "PROPERTY_PENDING_APPROVAL",
  PENDING_EDIT_BLOCKED: "PROPERTY_PENDING_EDIT_REQUEST",
  NO_UPDATE_DATA: "PROPERTY_NO_UPDATE_DATA",
  INVALID_FIELD: "PROPERTY_INVALID_FIELD",
  DUPLICATE_CONFLICT: "PROPERTY_DUPLICATE",
  PUBLIC_IDENTIFIER_CONFLICT: "PROPERTY_PUBLIC_IDENTIFIER_CONFLICT",
  REQUEST_TOO_LARGE: "PROPERTY_REQUEST_TOO_LARGE",
  INVALID_SCHEMA: "PROPERTY_SCHEMA_INVALID",
  INVALID_STATUS: "PROPERTY_STATUS_INVALID",
  UNAUTHORIZED: "PROPERTY_ACCESS_DENIED",
  CODE_PARSE_ERROR: "PROPERTY_CODE_PARSE_ERROR",
  COMMISSION_PARSE_ERROR: "PROPERTY_COMMISSION_INVALID",
  AREA_INVALID: "PROPERTY_AREA_INVALID",
  REPEAT_REQUEST_FIELD_LIMIT: "PROPERTY_UPLOAD_FIELD_LIMIT_EXCEEDED",
  FIELD_COUNT_LIMIT: "PROPERTY_UPLOAD_FIELD_COUNT_EXCEEDED",
  FIELD_VALUE_LIMIT: "PROPERTY_UPLOAD_FIELD_VALUE_EXCEEDED",
  PART_COUNT_LIMIT: "PROPERTY_UPLOAD_PART_COUNT_EXCEEDED",
  INVALID_UPLOAD_FIELD_NAME: "PROPERTY_UPLOAD_FIELD_NAME_INVALID",
} as const;

type PropertyErrorCode = (typeof PROPERTY_ERROR_CODES)[keyof typeof PROPERTY_ERROR_CODES];

export interface AuthRequestWithFiles extends AuthRequest {
  files?: {
    [fieldname: string]: Express.Multer.File[];
  };
}

function propertyErrorPayload(
  req: Request,
  params: {
    error: string;
    code: PropertyErrorCode;
    field?: string;
    details?: Record<string, unknown> | string | number | boolean;
  }
): Record<string, unknown> {
  const requestId = getRequestId(req);
  return {
    error: params.error,
    code: params.code,
    ...(params.field ? { field: params.field } : {}),
    ...(params.details !== undefined ? { details: params.details } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

function sendPropertyError(
  res: Response,
  req: Request,
  statusCode: number,
  params: {
    error: string;
    code: PropertyErrorCode;
    field?: string;
    details?: Record<string, unknown> | string | number | boolean;
  }
): Response {
  return res.status(statusCode).json(propertyErrorPayload(req, params));
}

function logPropertyCreateValidationFailure(
  req: Request,
  flow: "broker" | "client",
  reason: string,
  details?: Record<string, unknown>
): void {
  console.warn("Property create validation failed:", {
    requestId: getRequestId(req),
    flow,
    reason,
    details,
  });
}

async function findPropertyIdByCode(rawCode: unknown): Promise<number | null> {
  const normalizedCode = stringOrNull(rawCode);
  if (!normalizedCode) {
    return null;
  }

  const rows = await runPropertyQuery<RowDataPacket[]>(
    `SELECT id FROM properties WHERE code = ? LIMIT 1`,
    [normalizedCode]
  );
  if (!rows || rows.length === 0) {
    return null;
  }

  return Number(rows[0].id);
}

function resolveCanonicalAreaInput(
  payload: Record<string, unknown>,
  canonicalField: string,
  legacyFields: string[]
): unknown {
  if (Object.prototype.hasOwnProperty.call(payload, canonicalField)) {
    return payload[canonicalField];
  }
  for (const legacyField of legacyFields) {
    if (Object.prototype.hasOwnProperty.call(payload, legacyField)) {
      return payload[legacyField];
    }
  }
  return undefined;
}

async function createPropertyInternal(
  req: AuthRequestWithFiles,
  res: Response,
  flow: "broker" | "client"
): Promise<Response> {
  const actorId = req.userId;
  if (!actorId) {
    return sendPropertyError(res, req, 401, {
      error: flow === "broker" ? "Corretor não autenticado." : "Usuario nao autenticado.",
      code: PROPERTY_ERROR_CODES.UNAUTHORIZED,
    });
  }

  const payload = req.body ?? {};
  const {
    title,
    description,
    type,
    purpose,
    is_promoted,
    promo_percentage,
    promo_start_date,
    promo_end_date,
    promotion_percentage,
    promotion_start,
    promotion_end,
    price,
    price_sale,
    price_rent,
    promotion_price,
    promotional_price,
    promotional_rent_price,
    promotional_rent_percentage,
    code,
    owner_name,
    owner_phone,
    address,
    quadra,
    lote,
    numero,
    sem_numero,
    bairro,
    complemento,
    city,
    state,
    cep,
    sem_cep,
    bedrooms,
    bathrooms,
    area_construida,
    area_terreno,
    area,
    area_construida_valor,
    area_terreno_valor,
    garage_spots,
    amenities,
    amenityIds,
    amenity_ids,
    featureIds,
    feature_ids,
    features,
    has_wifi,
    tem_piscina,
    tem_energia_solar,
    tem_automacao,
    tem_ar_condicionado,
    eh_mobiliada,
    valor_condominio,
    valor_iptu,
    sem_quadra,
    sem_lote,
    area_construida_unidade,
    area_terreno_unidade,
  } = payload;

  const semNumeroFlag = parseBoolean(sem_numero);
  const semQuadraFlag = parseBoolean(sem_quadra);
  const semLoteFlag = parseBoolean(sem_lote);
  const semCepFlag = parseBoolean(sem_cep);
  const hasBedrooms = Object.prototype.hasOwnProperty.call(payload, "bedrooms");
  const hasBathrooms = Object.prototype.hasOwnProperty.call(payload, "bathrooms");
  const hasGarageSpots = Object.prototype.hasOwnProperty.call(payload, "garage_spots");

  let normalizedAmenities: string[] = [];
  try {
    normalizedAmenities = normalizePropertyAmenities(
      amenities ??
        amenityIds ??
        amenity_ids ??
        featureIds ??
        feature_ids ??
        features ??
        null
    );
  } catch (amenityError) {
    logPropertyCreateValidationFailure(req, flow, "amenity_parse_error", {
      error: (amenityError as Error).message,
    });
    return sendPropertyError(res, req, 400, {
      error: (amenityError as Error).message,
      code: PROPERTY_ERROR_CODES.AMENITY_PARSE_ERROR,
      field: "amenities",
    });
  }

  const normalizedDescription = normalizePropertyDescription(String(description ?? ""));

  if (!title || !description || !type || !purpose || !address || !city || !state) {
    logPropertyCreateValidationFailure(req, flow, "missing_required_fields", {
      title: Boolean(title),
      descriptionLength: normalizedDescription.length,
      type: Boolean(type),
      purpose: Boolean(purpose),
      address: Boolean(address),
      city: Boolean(city),
      state: Boolean(state),
    });
    return sendPropertyError(res, req, 400, {
      error: flow === "broker" ? "Campos obrigatórios não informados." : "Campos obrigatórios não informados.",
      code: PROPERTY_ERROR_CODES.REQUIRED_FIELDS,
      field: resolveRequiredField(payload as Record<string, unknown>),
    });
  }

  const normalizedCode = stringOrNull(code);
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  const isMultipartRequest = contentType.includes("multipart/form-data");
  if (normalizedCode != null && normalizedCode.length > 0 && !(flow === "client" && isMultipartRequest)) {
    const duplicateIdByCode = await findPropertyIdByCode(normalizedCode);
    if (duplicateIdByCode != null) {
      return sendPropertyError(res, req, 409, {
        error: "Já existe um imóvel com esse código.",
        code: PROPERTY_ERROR_CODES.CODE_ALREADY_EXISTS,
        field: "code",
      });
    }
  }

  if (!hasValidPropertyDescription(description, MAX_PROPERTY_DESCRIPTION_LENGTH)) {
    logPropertyCreateValidationFailure(req, flow, "invalid_description_length", {
      descriptionLength: normalizedDescription.length,
      rawDescriptionLength: String(description ?? "").trim().length,
    });
    return sendPropertyError(res, req, 400, {
      error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
      code: PROPERTY_ERROR_CODES.DESCRIPTION_LENGTH_INVALID,
      field: "description",
    });
  }

  const normalizedType = normalizePropertyType(type);
  if (!normalizedType) {
    return sendPropertyError(res, req, 400, {
      error: "Tipo de imóvel inválido.",
      code: PROPERTY_ERROR_CODES.INVALID_TYPE,
      field: "type",
    });
  }

  const normalizedPurpose = normalizePurpose(purpose);
  if (!normalizedPurpose) {
    return sendPropertyError(res, req, 400, {
      error: "Finalidade do imóvel invalida.",
      code: PROPERTY_ERROR_CODES.INVALID_PURPOSE,
      field: "purpose",
    });
  }

  const requiredBairroError = validateRequiredBairro(bairro, normalizedType);
  if (requiredBairroError) {
    return sendPropertyError(res, req, 400, {
      error: requiredBairroError,
      code: PROPERTY_ERROR_CODES.REQUIRED_BAIRRO,
      field: "bairro",
    });
  }

  const createTextValidationError = [
    validateMaxTextLength(title, 'Título'),
    validateMaxTextLength(owner_name, 'Nome do proprietário'),
    validateMaxTextLength(address, 'Endereço'),
    validateMaxTextLength(numero, 'Número', 25),
    validateMaxTextLength(bairro, 'Bairro'),
    validateMaxTextLength(complemento, 'Complemento'),
    validateMaxTextLength(city, 'Cidade'),
    ...(semQuadraFlag ? [] : [validateMaxTextLength(quadra, 'Quadra', 25)]),
    ...(semLoteFlag ? [] : [validateMaxTextLength(lote, 'Lote', 25)]),
    validateMaxTextLength(code, 'Código'),
  ].find(Boolean);

  if (createTextValidationError) {
    logPropertyCreateValidationFailure(req, flow, "text_validation_error", {
      error: createTextValidationError,
    });
    return sendPropertyError(res, req, 400, {
      error: createTextValidationError,
      code: PROPERTY_ERROR_CODES.TEXT_VALIDATION_FAILED,
      field: resolveValidationFieldFromMessage(createTextValidationError),
    });
  }

  if (owner_phone && String(owner_phone).trim().length > 0) {
    const ownerPhoneDigits = String(owner_phone).replace(/\D/g, "");
    if (ownerPhoneDigits.length < 10 || ownerPhoneDigits.length > 13) {
      logPropertyCreateValidationFailure(req, flow, "invalid_owner_phone", {
        digitsLength: ownerPhoneDigits.length,
      });
      return sendPropertyError(res, req, 400, {
        error: "Telefone do proprietário inválido.",
        code: PROPERTY_ERROR_CODES.INVALID_OWNER_PHONE,
        field: "owner_phone",
      });
    }
  }

  const numeroNormalizado = normalizeAddressNumberForPersistence(numero, semNumeroFlag);

  let promotionFlag: 0 | 1 = 0;
  let promotionPercentage: number | null = null;
  let promotionalRentPercentage: number | null = null;
  let promotionStartDate: string | null = null;
  let promotionEndDate: string | null = null;
  let promotionStart: string | null = null;
  let promotionEnd: string | null = null;
  try {
    const promotionPercentageInput = promo_percentage ?? promotion_percentage;
    const promotionalRentPercentageInput = promotional_rent_percentage;
    const promotionStartInput = promo_start_date ?? promotion_start;
    const promotionEndInput = promo_end_date ?? promotion_end;
    promotionFlag = parseBoolean(is_promoted);
    promotionPercentage = parsePromotionPercentage(promotionPercentageInput);
    promotionalRentPercentage = parsePromotionPercentage(promotionalRentPercentageInput);
    promotionStartDate = parsePromotionDate(promotionStartInput);
    promotionEndDate = parsePromotionDate(promotionEndInput);
    promotionStart = parsePromotionDateTime(promotionStartInput);
    promotionEnd = parsePromotionDateTime(promotionEndInput);
    if (promotionFlag === 0) {
      promotionPercentage = null;
      promotionalRentPercentage = null;
      promotionStartDate = null;
      promotionEndDate = null;
      promotionStart = null;
      promotionEnd = null;
    }
  } catch (parseError) {
    logPropertyCreateValidationFailure(req, flow, "promotion_parse_error", {
      message: (parseError as Error).message,
    });
    return sendPropertyError(res, req, 400, {
      error: (parseError as Error).message,
      code: PROPERTY_ERROR_CODES.PROMOTION_PARSE_ERROR,
      field: "promotion",
    });
  }

  let numericPrice: number;
  let numericPriceSale: number | null = null;
  let numericPriceRent: number | null = null;
  let numericPromotionPrice: number | null = null;
  let numericPromotionalRentPrice: number | null = null;
  try {
    if (normalizedPurpose === "Venda") {
      numericPriceSale = parseOptionalPrice(price_sale) ?? parsePrice(price);
      numericPrice = numericPriceSale;
    } else if (normalizedPurpose === "Aluguel") {
      numericPriceRent = parseOptionalPrice(price_rent) ?? parsePrice(price);
      numericPrice = numericPriceRent;
    } else {
      numericPriceSale = parseOptionalPrice(price_sale);
      numericPriceRent = parseOptionalPrice(price_rent);
      if (numericPriceSale == null || numericPriceRent == null) {
        return sendPropertyError(res, req, 400, {
          error: "Informe os precos de venda e aluguel para esta finalidade.",
          code: PROPERTY_ERROR_CODES.PRICE_MISSING_FOR_PURPOSE,
          field: "price",
        });
      }
      numericPrice = numericPriceSale;
    }
    numericPromotionPrice = parseOptionalPrice(promotion_price ?? promotional_price) ?? null;
    numericPromotionalRentPrice = parseOptionalPrice(promotional_rent_price) ?? null;

    if (normalizedPurpose === "Venda") {
      numericPromotionalRentPrice = null;
      promotionalRentPercentage = null;
    } else if (normalizedPurpose === "Aluguel") {
      numericPromotionPrice = null;
      promotionPercentage = null;
    }

    if (
      numericPromotionPrice == null &&
      promotionPercentage != null &&
      numericPriceSale != null
    ) {
      numericPromotionPrice = Number((numericPriceSale * (1 - promotionPercentage / 100)).toFixed(2));
    }

    if (
      numericPromotionalRentPrice == null &&
      promotionalRentPercentage != null &&
      numericPriceRent != null
    ) {
      numericPromotionalRentPrice = Number(
        (numericPriceRent * (1 - promotionalRentPercentage / 100)).toFixed(2)
      );
    }

    if (
      numericPromotionPrice != null &&
      numericPriceSale != null &&
      numericPromotionPrice >= numericPriceSale
    ) {
      return sendPropertyError(res, req, 400, {
        error: "Preço promocional de venda deve ser menor que o preço de venda.",
        code: PROPERTY_ERROR_CODES.PROMOTION_PRICE_INVALID,
        field: "promotion_price",
      });
    }

    if (
      numericPromotionalRentPrice != null &&
      numericPriceRent != null &&
      numericPromotionalRentPrice >= numericPriceRent
    ) {
      return sendPropertyError(res, req, 400, {
        error: "Preço promocional de aluguel deve ser menor que o preço de aluguel.",
        code: PROPERTY_ERROR_CODES.PROMOTION_PRICE_INVALID,
        field: "promotional_rent_price",
      });
    }

    if (numericPromotionPrice != null || numericPromotionalRentPrice != null) {
      promotionFlag = 1;
    }
    if (promotionPercentage != null || promotionalRentPercentage != null) {
      promotionFlag = 1;
    }
  } catch (parseError) {
    logPropertyCreateValidationFailure(req, flow, "price_parse_error", {
      message: (parseError as Error).message,
    });
    return sendPropertyError(res, req, 400, {
      error: (parseError as Error).message,
      code: PROPERTY_ERROR_CODES.PRICE_INVALID,
      field: resolveValidationFieldFromMessage((parseError as Error).message),
    });
  }

  try {
    if (flow === "broker") {
      const brokerRows = await runPropertyQuery<RowDataPacket[]>(
        'SELECT status FROM brokers WHERE id = ?',
        [actorId]
      );

      if (!brokerRows || brokerRows.length === 0) {
        return res.status(403).json({ error: "Conta de corretor não encontrada." });
      }

      const brokerStatus = String(brokerRows[0].status ?? '').trim().toLowerCase();
      if (brokerStatus !== 'approved') {
        return res
          .status(403)
          .json({ error: 'Apenas corretores aprovados podem criar imóveis.' });
      }
    }

    const { effectiveQuadra, effectiveLote } = resolvePropertyCreationLocationExtras({
      quadra,
      lote,
      semQuadraFlag: Boolean(semQuadraFlag),
      semLoteFlag: Boolean(semLoteFlag),
    });

    let numericBedrooms: number | null;
    let numericBathrooms: number | null;
    let numericGarageSpots: number | null;
    let areaConstruida: {
      valor: number | null;
      unidade: AreaConstruidaUnidade;
      m2: number | null;
    };
    let areaTerreno: {
      valor: number | null;
      unidade: AreaConstruidaUnidade;
      m2: number | null;
    };
    let numericValorCondominio: number | null = null;
    let numericValorIptu: number | null = null;

    try {
      numericBedrooms = normalizeNumericCountField(bedrooms, {
        label: "Quartos",
        required: true,
        hasField: hasBedrooms,
      });
      numericBathrooms = normalizeNumericCountField(bathrooms, {
        label: "Banheiros",
        required: true,
        hasField: hasBathrooms,
      });
      numericGarageSpots = normalizeNumericCountField(garage_spots, {
        label: "Garagens",
        required: true,
        hasField: hasGarageSpots,
      });
      const nextAreaConstruidaInput = resolveCanonicalAreaInput(
        payload as Record<string, unknown>,
        'area_construida_valor',
        ['area_construida', 'area']
      );
      const nextAreaTerrenoInput = resolveCanonicalAreaInput(
        payload as Record<string, unknown>,
        'area_terreno_valor',
        ['area_terreno']
      );

      areaConstruida = parseAreaWithUnit({
        value: nextAreaConstruidaInput,
        unidade: area_construida_unidade,
        label: "Área construída",
      });
      areaTerreno = parseAreaWithUnit({
        value: nextAreaTerrenoInput,
        unidade: area_terreno_unidade,
        label: "Área do terreno",
      });
      numericValorCondominio = parseDecimal(valor_condominio);
      numericValorIptu = parseDecimal(valor_iptu);
    } catch (parseError) {
      logPropertyCreateValidationFailure(req, flow, "numeric_parse_error", {
        message: (parseError as Error).message,
      });
      return sendPropertyError(res, req, 400, {
        error: (parseError as Error).message,
        code: PROPERTY_ERROR_CODES.NUMERIC_PARSE_ERROR,
        field: resolveValidationFieldFromMessage((parseError as Error).message),
      });
    }

    const requiresTerrainArea = isTerrainAreaRequiredForType(normalizedType);
    if (requiresTerrainArea && areaTerreno.valor == null) {
      return sendPropertyError(res, req, 400, {
        error: "Área do terreno é obrigatória para o tipo de imóvel informado.",
        code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
        field: "area_terreno",
        details: {
          propertyType: normalizedType,
          requiredAreaField: "area_terreno_valor",
        },
      });
    }

    if (areaConstruida.m2 != null && areaTerreno.m2 != null && areaConstruida.m2 > areaTerreno.m2) {
      return sendPropertyError(res, req, 400, {
        error: 'Área construída não pode ser maior que a área do terreno.',
        code: PROPERTY_ERROR_CODES.AREA_RELATION_ERROR,
        field: "area_terreno",
      });
    }

    const numericValidationError = [
      validatePropertyNumericRange(numericPrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
      validatePropertyNumericRange(numericPriceSale, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(numericPriceRent, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(numericPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(numericPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(numericBedrooms, 'Quartos', { max: MAX_PROPERTY_COUNT }),
      validatePropertyNumericRange(numericBathrooms, 'Banheiros', { max: MAX_PROPERTY_COUNT }),
      validatePropertyNumericRange(numericGarageSpots, 'Garagens', { max: MAX_PROPERTY_COUNT }),
      validateAreaByInputUnit(areaConstruida, 'Área construída', { allowNull: true }),
      validateAreaByInputUnit(areaTerreno, 'Área do terreno', { allowNull: !requiresTerrainArea }),
      validatePropertyNumericRange(numericValorCondominio, 'Valor de condomínio', { max: MAX_PROPERTY_FEE, allowNull: true }),
      validatePropertyNumericRange(numericValorIptu, 'Valor de IPTU', { max: MAX_PROPERTY_FEE, allowNull: true }),
    ].find(Boolean);

    if (numericValidationError) {
      logPropertyCreateValidationFailure(req, flow, "numeric_validation_error", {
        error: numericValidationError,
      });
      return sendPropertyError(res, req, 400, {
        error: numericValidationError,
        code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
        field: resolveValidationFieldFromMessage(numericValidationError),
      });
    }

    const hasAmenityPayload = hasAnyOwnPayloadField(
      payload as Record<string, unknown>,
      ["amenities", "amenityIds", "amenity_ids", "featureIds", "feature_ids", "features"]
    );
    const amenityLegacyFlags = deriveLegacyAmenityFlagsFromCanonicalAmenities(normalizedAmenities);
    const hasWifiFlag = hasAmenityPayload ? amenityLegacyFlags.hasWifi : parseBoolean(has_wifi);
    const temPiscinaFlag = hasAmenityPayload ? amenityLegacyFlags.temPiscina : parseBoolean(tem_piscina);
    const temEnergiaSolarFlag = hasAmenityPayload ? amenityLegacyFlags.temEnergiaSolar : parseBoolean(tem_energia_solar);
    const temAutomacaoFlag = hasAmenityPayload ? amenityLegacyFlags.temAutomacao : parseBoolean(tem_automacao);
    const temArCondicionadoFlag = hasAmenityPayload ? amenityLegacyFlags.temArCondicionado : parseBoolean(tem_ar_condicionado);
    const ehMobiliadaFlag = hasAmenityPayload ? amenityLegacyFlags.ehMobiliada : parseBoolean(eh_mobiliada);

    const imageUrls: string[] = [];
    const files = req.files ?? {};
    const imageFiles = files.images ?? [];
    const bodyImages = req.body?.images
      ? (Array.isArray(req.body.images) ? req.body.images : [req.body.images])
          .filter((v: unknown) => typeof v === 'string' && String(v).startsWith('http'))
      : [];

    if (imageFiles.length + bodyImages.length < 1) {
      logPropertyCreateValidationFailure(req, flow, "missing_images");
      return sendPropertyError(res, req, 400, {
        error: flow === "broker" ? 'Envie pelo menos 1 imagem do imóvel.' : 'Envie pelo menos 1 imagem do imovel.',
        code: PROPERTY_ERROR_CODES.IMAGE_REQUIRED,
        field: "images",
      });
    }

    if (imageFiles.length + bodyImages.length > MAX_IMAGES_PER_PROPERTY) {
      return sendPropertyError(res, req, 400, {
        error: `Limite maximo de ${MAX_IMAGES_PER_PROPERTY} imagens por imovel.`,
        code: PROPERTY_ERROR_CODES.IMAGE_LIMIT_EXCEEDED,
        field: "images",
      });
    }

    imageUrls.push(...bodyImages);
    const media = await uploadPropertyMedia(
      imageFiles,
      imageUrls,
      req.body?.video,
      files.video?.[0]
    );
    const { imageUrls: uploadedImageUrls, videoUrl } = media;

    const trimmedPropertyCode = resolvePropertyCreationCode(code);
    const resolvedPropertyCode =
      trimmedPropertyCode ?? await allocateNextPropertyCode();
    const { publicId, publicCode } = await allocatePublicPropertyIdentifiers();

    const propertyInsertValues = buildPropertyCreationInsertValues({
      brokerId: flow === "broker" ? actorId : null,
      ownerId: flow === "client" ? actorId : null,
      title,
      normalizedDescription,
      normalizedType,
      normalizedPurpose,
      promotionFlag,
      promotionPercentage,
      promotionStart,
      promotionEnd,
      promotionStartDate,
      promotionEndDate,
      numericPrice,
      numericPriceSale,
      numericPriceRent,
      numericPromotionPrice,
      numericPromotionalRentPrice,
      promotionalRentPercentage,
      propertyCode: resolvedPropertyCode,
      ownerName: owner_name,
      ownerPhone: owner_phone,
      address,
      effectiveQuadra,
      semQuadraFlag: Boolean(semQuadraFlag),
      effectiveLote,
      semLoteFlag: Boolean(semLoteFlag),
      numeroNormalizado,
      bairro,
      complemento,
      city,
      state,
      cep,
      semCepFlag: Boolean(semCepFlag),
      numericBedrooms,
      numericBathrooms,
      areaConstruida,
      areaTerreno,
      numericGarageSpots,
      normalizedAmenities,
      hasWifiFlag,
      temPiscinaFlag,
      temEnergiaSolarFlag,
      temAutomacaoFlag,
      temArCondicionadoFlag,
      ehMobiliadaFlag,
      numericValorCondominio,
      numericValorIptu,
      videoUrl,
      publicId,
      publicCode,
    });

    const propertyInsertPlaceholders = propertyInsertValues.map(() => '?').join(', ');
    const result = await runPropertyQuery<ResultSetHeader>(
      `
        INSERT INTO properties (
          broker_id,
          owner_id,
          title,
          description,
          type,
          purpose,
          status,
          is_promoted,
          promotion_percentage,
          promotion_start,
          promotion_end,
          promo_percentage,
          promo_start_date,
          promo_end_date,
          price,
          price_sale,
          price_rent,
          promotion_price,
          promotional_rent_price,
          promotional_rent_percentage,
          code,
          owner_name,
          owner_phone,
          address,
          quadra,
          sem_quadra,
          lote,
          sem_lote,
          numero,
          bairro,
          complemento,
          city,
          state,
          cep,
          sem_cep,
          bedrooms,
          bathrooms,
          area_construida,
          area_construida_unidade,
          area_terreno,
          area_construida_valor,
          area_construida_m2,
          area_terreno_valor,
          area_terreno_unidade,
          area_terreno_m2,
          garage_spots,
          amenities,
          has_wifi,
          tem_piscina,
          tem_energia_solar,
          tem_automacao,
          tem_ar_condicionado,
          eh_mobiliada,
          valor_condominio,
          valor_iptu,
          video_url,
          public_id,
          public_code
        ) VALUES (${propertyInsertPlaceholders})
      `,
      propertyInsertValues
    );

    const propertyId = result.insertId;
    await persistPropertyImages(propertyId, uploadedImageUrls);

    await runPropertyCreationPostPersistEffects({
      flow,
      propertyId,
      title,
      promotionFlag,
      promotionPercentage,
      ownerPhone: owner_phone,
      ownerName: owner_name,
      actorId,
    });

    return res.status(201).json({
      message: 'Imóvel criado com sucesso!',
      propertyId,
      status: 'pending_approval',
      images: uploadedImageUrls,
      video: videoUrl,
    });
  } catch (error) {
    const knownError = error as { statusCode?: number } | null;
    const message = error instanceof Error ? error.message : '';
    if (knownError?.statusCode === 413) {
      return sendPropertyError(res, req, 413, {
        error: 'Arquivo muito grande. Reduza o tamanho das imagens e tente novamente.',
        code: PROPERTY_ERROR_CODES.IMAGE_UPLOAD_TOO_LARGE,
        field: "images",
      });
    }
    if (message.includes("Out of range value for column 'price'")) {
      return sendPropertyError(res, req, 400, {
        error: 'Preço fora do limite permitido para o banco de dados. Reduza o valor e tente novamente.',
        code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
        field: "price",
      });
    }
    if (message.includes("Data truncated for column 'type'")) {
      return sendPropertyError(res, req, 400, {
        error: 'O tipo do imóvel não é aceito pelo schema atual do banco. Reinicie o backend para aplicar as migrations.',
        code: PROPERTY_ERROR_CODES.INVALID_SCHEMA,
        field: "type",
      });
    }
    if (message.includes('ER_DUP_ENTRY')) {
      if (message.includes('code')) {
        return sendPropertyError(res, req, 409, {
          error: 'Já existe um imóvel com esse código.',
          code: PROPERTY_ERROR_CODES.CODE_ALREADY_EXISTS,
          field: "code",
        });
      }
      if (message.includes('uq_public_code') || message.includes('public_code')) {
        return sendPropertyError(res, req, 409, {
          error: 'Já existe um imóvel com esse identificador público.',
          code: PROPERTY_ERROR_CODES.PUBLIC_IDENTIFIER_CONFLICT,
          field: "public_code",
        });
      }
    }
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

export async function createBrokerProperty(
  req: AuthRequestWithFiles,
  res: Response
): Promise<Response> {
  return createPropertyInternal(req, res, "broker");
}

export async function createClientProperty(
  req: AuthRequestWithFiles,
  res: Response
): Promise<Response> {
  return createPropertyInternal(req, res, "client");
}
