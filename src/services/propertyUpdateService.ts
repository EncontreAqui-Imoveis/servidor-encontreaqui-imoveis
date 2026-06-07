import { Response } from 'express';
import { RowDataPacket } from 'mysql2';
import AuthRequest from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import { runPropertyQuery, type PropertyQueryExecutor } from './propertyPersistenceService';
import { applyPropertyUpdateEffects } from './propertyUpdateEffectsService';
import { deriveLegacyAmenityFlagsFromCanonicalAmenities } from './propertyCreationPreparationService';
import { normalizePropertyAmenities } from '../utils/propertyAmenities';
import {
  areaInputToSquareMeters,
  normalizeAreaUnidade,
  type AreaConstruidaUnidade,
} from '../utils/propertyAreaUnits';
import { normalizePropertyType } from '../utils/propertyTypes';
import {
  normalizeCepForPersistence,
  normalizeNumericCountField,
  normalizePurpose,
  normalizeStatus,
  normalizePropertyDescription,
  hasValidPropertyDescription,
  parseAreaWithUnit,
  parseBoolean,
  parseDecimal,
  parseOptionalPrice,
  parsePrice,
  parsePromotionDate,
  parsePromotionDateTime,
  parsePromotionPercentage,
  resolveValidationFieldFromMessage,
  stringOrNull,
  toBoolean,
  validateAreaByInputUnit,
  validateMaxTextLength,
  validatePropertyNumericRange,
  validateRequiredBairro,
} from './propertyUpdateValidationService';

type PropertyStatus = 'pending_approval' | 'approved' | 'rejected' | 'rented' | 'sold';
type Nullable<T> = T | null;

type PropertyRow = RowDataPacket & Record<string, any>;
const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_PROPERTY_COUNT = 99;
const MAX_PROPERTY_PRICE = 9999999999.99;
const MAX_PROPERTY_FEE = 99999999.99;

const PROPERTY_ERROR_CODES = {
  INVALID_FIELD: 'PROPERTY_INVALID_FIELD',
  NO_UPDATE_DATA: 'PROPERTY_NO_UPDATE_DATA',
  UNAUTHORIZED: 'PROPERTY_ACCESS_DENIED',
  PENDING_EDIT_BLOCKED: 'PROPERTY_PENDING_EDIT_REQUEST',
  DESCRIPTION_LENGTH_INVALID: 'PROPERTY_DESCRIPTION_LENGTH_INVALID',
  REQUIRED_BAIRRO: 'PROPERTY_REQUIRED_BAIRRO',
  TEXT_VALIDATION_FAILED: 'PROPERTY_TEXT_VALIDATION_FAILED',
  INVALID_STATUS: 'PROPERTY_INVALID_STATUS',
  INVALID_PURPOSE: 'PROPERTY_INVALID_PURPOSE',
  INVALID_TYPE: 'PROPERTY_INVALID_TYPE',
  PRICE_INVALID: 'PROPERTY_PRICE_INVALID',
  NUMERIC_PARSE_ERROR: 'PROPERTY_NUMERIC_PARSE_ERROR',
  AMENITY_PARSE_ERROR: 'PROPERTY_AMENITY_PARSE_ERROR',
  INVALID_OWNER_PHONE: 'PROPERTY_OWNER_PHONE_INVALID',
  PROMOTION_PARSE_ERROR: 'PROPERTY_PROMOTION_PARSE_ERROR',
  NUMERIC_RANGE_ERROR: 'PROPERTY_NUMERIC_RANGE_ERROR',
  AREA_RELATION_ERROR: 'PROPERTY_AREA_RELATION_INVALID',
} as const;

const ALLOWED_PROPERTY_TEXT_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'type',
  'purpose',
  'status',
  'price',
  'price_sale',
  'price_rent',
  'promotion_price',
  'promotional_price',
  'promotional_rent_price',
  'promotional_rent_percentage',
  'is_promoted',
  'promo_percentage',
  'promo_start_date',
  'promo_end_date',
  'promotion_percentage',
  'promotion_start',
  'promotion_end',
  'code',
  'owner_name',
  'owner_phone',
  'address',
  'quadra',
  'lote',
  'numero',
  'sem_numero',
  'bairro',
  'complemento',
  'city',
  'state',
  'cep',
  'sem_cep',
  'bedrooms',
  'bathrooms',
  'area_construida',
  'area_construida_valor',
  'area_construida_unidade',
  'area_terreno',
  'area_terreno_valor',
  'area_terreno_unidade',
  'garage_spots',
  'amenities',
  'has_wifi',
  'tem_piscina',
  'tem_energia_solar',
  'tem_automacao',
  'tem_ar_condicionado',
  'eh_mobiliada',
  'valor_condominio',
  'valor_iptu',
  'video_url',
]);

function sendPropertyError(
  req: AuthRequest | undefined,
  res: Response,
  statusCode: number,
  params: { error: string; code: (typeof PROPERTY_ERROR_CODES)[keyof typeof PROPERTY_ERROR_CODES]; field?: string }
): Response {
  return res.status(statusCode).json({
    error: params.error,
    code: params.code,
    ...(params.field ? { field: params.field } : {}),
    ...(req ? { requestId: getRequestId(req) } : {}),
  });
}

export async function updateProperty(req: AuthRequest, res: Response) {
  const propertyId = Number(req.params.id);
  const userId = req.userId;
  const isAdminRequest = req.userRole === 'admin';

  if (!userId && !isAdminRequest) {
    return sendPropertyError(req, res, 401, {
      error: 'Usuario nao autenticado.',
      code: PROPERTY_ERROR_CODES.UNAUTHORIZED,
    });
  }

  if (req.userRole === 'client') {
    return sendPropertyError(req, res, 403, {
      error:
        'Clientes nao podem editar imovel diretamente. Envie uma solicitacao de edicao para aprovacao.',
      code: PROPERTY_ERROR_CODES.UNAUTHORIZED,
    });
  }

  if (Number.isNaN(propertyId)) {
    return sendPropertyError(req, res, 400, {
      error: 'Identificador de imóvel invalido.',
      code: PROPERTY_ERROR_CODES.INVALID_FIELD,
      field: 'id',
    });
  }

  try {
    const propertyRows = await runPropertyQuery<PropertyRow[]>(
      'SELECT * FROM properties WHERE id = ?',
      [propertyId]
    );

    if (!propertyRows || propertyRows.length === 0) {
      return sendPropertyError(req, res, 404, {
        error: 'Imóvel nao encontrado.',
        code: PROPERTY_ERROR_CODES.INVALID_FIELD,
        field: 'id',
      });
    }

    const property = propertyRows[0];
    const brokerId = property.broker_id != null ? Number(property.broker_id) : null;

    const isOwner =
      isAdminRequest ||
      (property.broker_id != null && property.broker_id === userId) ||
      (property.owner_id != null && property.owner_id === userId);
    if (!isOwner) {
      return sendPropertyError(req, res, 403, {
        error: 'Acesso nao autorizado a este imovel.',
        code: PROPERTY_ERROR_CODES.UNAUTHORIZED,
        field: 'userId',
      });
    }
    if (property.status === 'pending_approval') {
      return sendPropertyError(req, res, 409, {
        error: 'Imóveis pendentes não podem ser editados até o fim da análise.',
        code: PROPERTY_ERROR_CODES.PENDING_EDIT_BLOCKED,
      });
    }

    const previousSalePrice =
      property.price_sale != null ? Number(property.price_sale) : Number(property.price);
    const previousRentPrice =
      property.price_rent != null ? Number(property.price_rent) : Number(property.price);
    const previousPromotionFlag = toBoolean(property.is_promoted);

    const body = req.body ?? {};
    const normalizedUpdateBody: Record<string, unknown> = {
      ...body,
    } as Record<string, unknown>;
    const rawAmenitiesForUpdate =
      body.amenities ??
      body.amenityIds ??
      body.amenity_ids ??
      body.featureIds ??
      body.feature_ids ??
      body.features ??
      null;
    if (rawAmenitiesForUpdate != null) {
      normalizedUpdateBody.amenities = rawAmenitiesForUpdate;
      delete normalizedUpdateBody.amenityIds;
      delete normalizedUpdateBody.amenity_ids;
      delete normalizedUpdateBody.featureIds;
      delete normalizedUpdateBody.feature_ids;
      delete normalizedUpdateBody.features;
    }
    const bodyKeys = Object.keys(normalizedUpdateBody);
    const semNumeroBody =
      normalizedUpdateBody.sem_numero !== undefined
        ? parseBoolean(normalizedUpdateBody.sem_numero)
        : null;
    const semCepBody =
      normalizedUpdateBody.sem_cep !== undefined
        ? parseBoolean(normalizedUpdateBody.sem_cep)
        : parseBoolean(property.sem_cep);

    const nextDescription = normalizePropertyDescription(
      String(normalizedUpdateBody.description ?? property.description ?? '')
    );
    if (!hasValidPropertyDescription(nextDescription)) {
      return sendPropertyError(req, res, 400, {
        error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
        code: PROPERTY_ERROR_CODES.DESCRIPTION_LENGTH_INVALID,
        field: 'description',
      });
    }

    const nextType = normalizePropertyType(normalizedUpdateBody.type) ?? property.type;
    const requiredBairroError = validateRequiredBairro(
      normalizedUpdateBody.bairro ?? property.bairro,
      nextType
    );
    if (requiredBairroError) {
      return sendPropertyError(req, res, 400, {
        error: requiredBairroError,
        code: PROPERTY_ERROR_CODES.REQUIRED_BAIRRO,
        field: 'bairro',
      });
    }

    const updateTextValidationError = [
      validateMaxTextLength(normalizedUpdateBody.title ?? property.title, 'Título'),
      validateMaxTextLength(
        normalizedUpdateBody.owner_name ?? property.owner_name,
        'Nome do proprietário'
      ),
      validateMaxTextLength(normalizedUpdateBody.address ?? property.address, 'Endereço'),
      validateMaxTextLength(normalizedUpdateBody.numero ?? property.numero, 'Número', 25),
      validateMaxTextLength(normalizedUpdateBody.bairro ?? property.bairro, 'Bairro'),
      validateMaxTextLength(
        normalizedUpdateBody.complemento ?? property.complemento,
        'Complemento'
      ),
      validateMaxTextLength(normalizedUpdateBody.city ?? property.city, 'Cidade'),
      validateMaxTextLength(normalizedUpdateBody.quadra ?? property.quadra, 'Quadra', 25),
      validateMaxTextLength(normalizedUpdateBody.lote ?? property.lote, 'Lote', 25),
      validateMaxTextLength(normalizedUpdateBody.code ?? property.code, 'Código'),
    ].find(Boolean) as string | undefined;

    if (updateTextValidationError) {
      return sendPropertyError(req, res, 400, {
        error: updateTextValidationError,
        code: PROPERTY_ERROR_CODES.TEXT_VALIDATION_FAILED,
        field: resolveValidationFieldFromMessage(updateTextValidationError),
      });
    }

    const nextPurpose = normalizePurpose(normalizedUpdateBody.purpose) ?? property.purpose;
    const purposeLower = String(nextPurpose ?? '').toLowerCase();
    const supportsSale = purposeLower.includes('vend');
    const supportsRent = purposeLower.includes('alug');
    let nextSalePrice = previousSalePrice;
    let nextRentPrice = previousRentPrice;
    let saleTouched = false;
    let rentTouched = false;
    let nextPromotionFlag = previousPromotionFlag ? 1 : 0;
    let nextPromotionPercentage =
      property.promo_percentage != null
        ? Number(property.promo_percentage)
        : property.promotion_percentage != null
          ? Number(property.promotion_percentage)
          : null;
    let nextPromotionPrice =
      property.promotion_price != null ? Number(property.promotion_price) : null;
    let nextPromotionalRentPrice =
      property.promotional_rent_price != null
        ? Number(property.promotional_rent_price)
        : null;
    let nextPromotionalRentPercentage =
      property.promotional_rent_percentage != null
        ? Number(property.promotional_rent_percentage)
        : null;
    let nextAreaConstruida =
      property.area_construida_valor != null
        ? Number(property.area_construida_valor)
        : property.area_construida != null
          ? Number(property.area_construida)
          : null;
    let nextAreaTerreno =
      property.area_terreno_valor != null
        ? Number(property.area_terreno_valor)
        : property.area_terreno != null
          ? Number(property.area_terreno)
          : null;
    let nextAreaConstruidaM2 =
      property.area_construida_m2 != null
        ? Number(property.area_construida_m2)
        : nextAreaConstruida != null
          ? nextAreaConstruida
          : null;
    let nextAreaTerrenoM2 =
      property.area_terreno_m2 != null
        ? Number(property.area_terreno_m2)
        : nextAreaTerreno != null
          ? nextAreaTerreno
          : null;
    let nextAreaConstruidaUnidade = normalizeAreaUnidade(
      property.area_construida_unidade
    );
    let nextAreaTerrenoUnidade = normalizeAreaUnidade(property.area_terreno_unidade);
    let hasAreaConstruidaPatch = false;
    let hasAreaTerrenoPatch = false;

    const fields: string[] = [];
    const values: any[] = [];
    let nextStatus: Nullable<PropertyStatus> = null;

    for (const key of bodyKeys) {
      if (!ALLOWED_PROPERTY_TEXT_UPDATE_FIELDS.has(key)) {
        continue;
      }

      switch (key) {
        case 'status': {
          const normalized = normalizeStatus(normalizedUpdateBody.status);
          if (!normalized) {
            return sendPropertyError(req, res, 400, {
              error: 'Status informado invalido.',
              code: PROPERTY_ERROR_CODES.INVALID_STATUS,
              field: 'status',
            });
          }
          nextStatus = normalized;
          fields.push('status = ?');
          values.push(normalized);
          break;
        }
        case 'purpose': {
          const normalized = normalizePurpose(normalizedUpdateBody.purpose);
          if (!normalized) {
            return sendPropertyError(req, res, 400, {
              error: 'Finalidade informada e invalida.',
              code: PROPERTY_ERROR_CODES.INVALID_PURPOSE,
              field: 'purpose',
            });
          }
          fields.push('purpose = ?');
          values.push(normalized);
          break;
        }
        case 'type': {
          const normalized = normalizePropertyType(normalizedUpdateBody.type);
          if (!normalized) {
            return sendPropertyError(req, res, 400, {
              error: 'Tipo de imóvel inválido.',
              code: PROPERTY_ERROR_CODES.INVALID_TYPE,
              field: 'type',
            });
          }
          fields.push('type = ?');
          values.push(normalized);
          break;
        }
        case 'price': {
          try {
            const parsed = parsePrice(normalizedUpdateBody.price);
            fields.push('price = ?');
            values.push(parsed);
            if (supportsSale && !supportsRent) {
              nextSalePrice = parsed;
              saleTouched = true;
            } else if (supportsRent && !supportsSale) {
              nextRentPrice = parsed;
              rentTouched = true;
            } else if (supportsSale && supportsRent) {
              nextSalePrice = parsed;
              saleTouched = true;
            }
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.PRICE_INVALID,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'price_sale':
        case 'price_rent': {
          try {
            const parsed = parsePrice(normalizedUpdateBody[key]);
            fields.push(`\`${key}\` = ?`);
            values.push(parsed);
            if (key === 'price_sale') {
              nextSalePrice = parsed;
              saleTouched = true;
            } else {
              nextRentPrice = parsed;
              rentTouched = true;
            }
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.PRICE_INVALID,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'bedrooms':
        case 'bathrooms':
        case 'garage_spots': {
          try {
            fields.push(`\`${key}\` = ?`);
            values.push(
              normalizeNumericCountField(normalizedUpdateBody[key], {
                label:
                  key === 'garage_spots'
                    ? 'Garagens'
                    : key === 'bedrooms'
                      ? 'Quartos'
                      : 'Banheiros',
                hasField: Object.prototype.hasOwnProperty.call(normalizedUpdateBody, key),
                required: false,
              })
            );
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_PARSE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'amenities': {
          try {
            const normalizedAmenityList = normalizePropertyAmenities(normalizedUpdateBody.amenities);
            const legacyAmenityFlags =
              deriveLegacyAmenityFlagsFromCanonicalAmenities(normalizedAmenityList);
            fields.push('amenities = ?');
            values.push(
              normalizedAmenityList.length > 0
                ? JSON.stringify(normalizedAmenityList)
                : null
            );
            fields.push('has_wifi = ?');
            values.push(legacyAmenityFlags.hasWifi);
            fields.push('tem_piscina = ?');
            values.push(legacyAmenityFlags.temPiscina);
            fields.push('tem_energia_solar = ?');
            values.push(legacyAmenityFlags.temEnergiaSolar);
            fields.push('tem_automacao = ?');
            values.push(legacyAmenityFlags.temAutomacao);
            fields.push('tem_ar_condicionado = ?');
            values.push(legacyAmenityFlags.temArCondicionado);
            fields.push('eh_mobiliada = ?');
            values.push(legacyAmenityFlags.ehMobiliada);
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.AMENITY_PARSE_ERROR,
              field: 'amenities',
            });
          }
          break;
        }
        case 'area_construida':
        case 'area_construida_valor':
        case 'area_construida_unidade':
        case 'area_terreno':
        case 'area_terreno_valor':
        case 'area_terreno_unidade': {
          try {
            if (key === 'area_construida_unidade') {
              const nextParsedArea = parseAreaWithUnit({
                value: nextAreaConstruida,
                unidade: normalizedUpdateBody[key],
                label: 'Área construída',
              });
              nextAreaConstruidaUnidade = nextParsedArea.unidade;
              nextAreaConstruidaM2 = nextParsedArea.m2;
              hasAreaConstruidaPatch = true;
              break;
            }
            if (key === 'area_construida_valor') {
              const parsedArea = parseDecimal(normalizedUpdateBody[key]);
              nextAreaConstruida = parsedArea;
              nextAreaConstruidaM2 =
                parsedArea == null
                  ? null
                  : Number(areaInputToSquareMeters(parsedArea, nextAreaConstruidaUnidade).toFixed(2));
              hasAreaConstruidaPatch = true;
              break;
            }
            if (key === 'area_terreno_unidade') {
              const nextParsedArea = parseAreaWithUnit({
                value: nextAreaTerreno,
                unidade: normalizedUpdateBody[key],
                label: 'Área do terreno',
              });
              nextAreaTerrenoUnidade = nextParsedArea.unidade;
              nextAreaTerrenoM2 = nextParsedArea.m2;
              hasAreaTerrenoPatch = true;
              break;
            }
            if (key === 'area_terreno_valor') {
              const parsedArea = parseDecimal(normalizedUpdateBody[key]);
              nextAreaTerreno = parsedArea;
              nextAreaTerrenoM2 =
                parsedArea == null
                  ? null
                  : Number(areaInputToSquareMeters(parsedArea, nextAreaTerrenoUnidade).toFixed(2));
              hasAreaTerrenoPatch = true;
              break;
            }
            if (key === 'area_terreno') {
              const parsedArea = parseAreaWithUnit({
                value: normalizedUpdateBody[key],
                unidade: nextAreaTerrenoUnidade,
                label: 'Área do terreno',
              });
              nextAreaTerreno = parsedArea.valor;
              nextAreaTerrenoM2 = parsedArea.m2;
              hasAreaTerrenoPatch = true;
              break;
            }
            const parsedArea = parseAreaWithUnit({
              value: normalizedUpdateBody[key],
              unidade: nextAreaConstruidaUnidade,
              label: 'Área construída',
            });
            nextAreaConstruida = parsedArea.valor;
            nextAreaConstruidaM2 = parsedArea.m2;
            nextAreaConstruidaUnidade = parsedArea.unidade;
            hasAreaConstruidaPatch = true;
            break;
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_PARSE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'valor_condominio':
        case 'valor_iptu': {
          try {
            fields.push(`\`${key}\` = ?`);
            values.push(parseDecimal(normalizedUpdateBody[key]));
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_PARSE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'has_wifi':
        case 'tem_piscina':
        case 'tem_energia_solar':
        case 'tem_automacao':
        case 'tem_ar_condicionado':
        case 'eh_mobiliada': {
          fields.push(`\`${key}\` = ?`);
          values.push(parseBoolean(normalizedUpdateBody[key]));
          break;
        }
        case 'is_promoted': {
          fields.push('is_promoted = ?');
          values.push(parseBoolean(normalizedUpdateBody[key]));
          nextPromotionFlag = parseBoolean(normalizedUpdateBody[key]);
          break;
        }
        case 'promo_percentage':
        case 'promotion_percentage': {
          try {
            const parsed = parsePromotionPercentage(normalizedUpdateBody[key]);
            fields.push('promo_percentage = ?');
            values.push(parsed);
            nextPromotionPercentage = parsed;
            if (parsed != null) nextPromotionFlag = 1;
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'promotion_price':
        case 'promotional_price': {
          try {
            const parsed = parseOptionalPrice(normalizedUpdateBody[key]);
            fields.push('promotion_price = ?');
            values.push(parsed);
            nextPromotionPrice = parsed;
            if (parsed != null) nextPromotionFlag = 1;
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'promotional_rent_price': {
          try {
            const parsed = parseOptionalPrice(normalizedUpdateBody[key]);
            fields.push('promotional_rent_price = ?');
            values.push(parsed);
            nextPromotionalRentPrice = parsed;
            if (parsed != null) nextPromotionFlag = 1;
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'promotional_rent_percentage': {
          try {
            const parsed = parsePromotionPercentage(normalizedUpdateBody[key]);
            fields.push('promotional_rent_percentage = ?');
            values.push(parsed);
            nextPromotionalRentPercentage = parsed;
            if (parsed != null) nextPromotionFlag = 1;
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'promo_start_date':
        case 'promotion_start':
        case 'promo_end_date':
        case 'promotion_end': {
          try {
            const parsedDate = parsePromotionDate(normalizedUpdateBody[key]);
            const parsedDateTime = parsePromotionDateTime(normalizedUpdateBody[key]);
            if (key === 'promotion_start' || key === 'promo_start_date') {
              fields.push('promo_start_date = ?');
              values.push(parsedDate);
              fields.push('promotion_start = ?');
              values.push(parsedDateTime);
            } else {
              fields.push('promo_end_date = ?');
              values.push(parsedDate);
              fields.push('promotion_end = ?');
              values.push(parsedDateTime);
            }
          } catch (parseError) {
            return sendPropertyError(req, res, 400, {
              error: (parseError as Error).message,
              code: PROPERTY_ERROR_CODES.PROMOTION_PARSE_ERROR,
              field: resolveValidationFieldFromMessage((parseError as Error).message),
            });
          }
          break;
        }
        case 'owner_phone': {
          const text = String(normalizedUpdateBody[key] ?? '').trim();
          if (text.length > 0) {
            const digits = text.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 13) {
              return sendPropertyError(req, res, 400, {
                error: 'Telefone do proprietário inválido.',
                code: PROPERTY_ERROR_CODES.INVALID_OWNER_PHONE,
                field: 'owner_phone',
              });
            }
            fields.push('owner_phone = ?');
            values.push(digits);
          } else {
            fields.push('owner_phone = ?');
            values.push(null);
          }
          break;
        }
        case 'sem_numero':
          break;
        case 'numero': {
          if (semNumeroBody === 1) {
            fields.push('numero = ?');
            values.push(null);
            break;
          }
          const rawNumero = String(normalizedUpdateBody.numero ?? '').trim();
          const numeroDigits = rawNumero.replace(/\D/g, '');
          if (rawNumero.length > 0 && numeroDigits.length === 0) {
            return sendPropertyError(req, res, 400, {
              error: 'Número do endereço deve conter apenas dígitos.',
              code: PROPERTY_ERROR_CODES.INVALID_FIELD,
              field: 'numero',
            });
          }
          fields.push('numero = ?');
          values.push(stringOrNull(numeroDigits));
          break;
        }
        case 'sem_cep':
          fields.push('sem_cep = ?');
          values.push(parseBoolean(normalizedUpdateBody[key]));
          break;
        case 'cep':
          fields.push('cep = ?');
          values.push(normalizeCepForPersistence(normalizedUpdateBody[key], semCepBody));
          break;
        default: {
          if (!ALLOWED_PROPERTY_TEXT_UPDATE_FIELDS.has(key)) {
            continue;
          }
          fields.push(`\`${key}\` = ?`);
          values.push(stringOrNull(normalizedUpdateBody[key]));
        }
      }
    }

    if (hasAreaConstruidaPatch) {
      fields.push('area_construida = ?');
      values.push(nextAreaConstruidaM2);
      fields.push('area_construida_unidade = ?');
      values.push(nextAreaConstruidaUnidade);
      fields.push('area_construida_valor = ?');
      values.push(nextAreaConstruida);
      fields.push('area_construida_m2 = ?');
      values.push(nextAreaConstruidaM2);
    }
    if (hasAreaTerrenoPatch) {
      fields.push('area_terreno = ?');
      values.push(nextAreaTerrenoM2);
      fields.push('area_terreno_unidade = ?');
      values.push(nextAreaTerrenoUnidade);
      fields.push('area_terreno_valor = ?');
      values.push(nextAreaTerreno);
      fields.push('area_terreno_m2 = ?');
      values.push(nextAreaTerrenoM2);
    }

    if (semNumeroBody === 1 && !bodyKeys.includes('numero')) {
      fields.push('numero = ?');
      values.push(null);
    }

    if (semCepBody === 1 && !bodyKeys.includes('cep')) {
      fields.push('cep = ?');
      values.push(null);
    }

    if (!supportsSale && bodyKeys.some((key) => key === 'promotion_price' || key === 'promotional_price')) {
      fields.push('promotion_price = ?');
      values.push(null);
      nextPromotionPrice = null;
    }

    if (!supportsRent && bodyKeys.includes('promotional_rent_price')) {
      fields.push('promotional_rent_price = ?');
      values.push(null);
      nextPromotionalRentPrice = null;
    }

    if (!supportsRent && bodyKeys.includes('promotional_rent_percentage')) {
      fields.push('promotional_rent_percentage = ?');
      values.push(null);
      nextPromotionalRentPercentage = null;
    }

    const nextBasePrice =
      supportsSale && nextSalePrice != null
        ? nextSalePrice
        : supportsRent
          ? nextRentPrice
          : nextSalePrice;
    const hasAreaUpdate =
      bodyKeys.includes('area_construida') ||
      bodyKeys.includes('area_construida_valor') ||
      bodyKeys.includes('area_terreno') ||
      bodyKeys.includes('area_terreno_valor') ||
      bodyKeys.includes('area_construida_unidade') ||
      bodyKeys.includes('area_terreno_unidade');
    const nextAreaConstruidaState =
      hasAreaUpdate
        ? nextAreaConstruidaM2
        : property.area_construida_m2 != null
          ? Number(property.area_construida_m2)
          : property.area_construida != null
            ? Number(property.area_construida)
            : null;
    const nextAreaTerrenoState =
      hasAreaUpdate
        ? nextAreaTerrenoM2
        : property.area_terreno_m2 != null
          ? Number(property.area_terreno_m2)
          : property.area_terreno != null
            ? Number(property.area_terreno)
            : null;
    const numericValidationError = [
      validatePropertyNumericRange(nextBasePrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
      validatePropertyNumericRange(nextSalePrice, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(nextRentPrice, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(nextPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(nextPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      bodyKeys.includes('bedrooms')
        ? validatePropertyNumericRange(
            normalizeNumericCountField(normalizedUpdateBody.bedrooms, {
              label: 'Quartos',
              required: false,
              hasField: bodyKeys.includes('bedrooms'),
            }),
            'Quartos',
            { max: MAX_PROPERTY_COUNT, allowNull: true }
          )
        : null,
      bodyKeys.includes('bathrooms')
        ? validatePropertyNumericRange(
            normalizeNumericCountField(normalizedUpdateBody.bathrooms, {
              label: 'Banheiros',
              required: false,
              hasField: bodyKeys.includes('bathrooms'),
            }),
            'Banheiros',
            { max: MAX_PROPERTY_COUNT, allowNull: true }
          )
        : null,
      bodyKeys.includes('garage_spots')
        ? validatePropertyNumericRange(
            normalizeNumericCountField(normalizedUpdateBody.garage_spots, {
              label: 'Garagens',
              required: false,
              hasField: bodyKeys.includes('garage_spots'),
            }),
            'Garagens',
            { max: MAX_PROPERTY_COUNT, allowNull: true }
          )
        : null,
      hasAreaUpdate
        ? validateAreaByInputUnit(
            {
              valor: nextAreaConstruida,
              unidade: nextAreaConstruidaUnidade,
              m2: nextAreaConstruidaM2,
            },
            'Área construída',
            { allowNull: true }
          )
        : null,
      hasAreaUpdate
        ? validateAreaByInputUnit(
            {
              valor: nextAreaTerreno,
              unidade: nextAreaTerrenoUnidade,
              m2: nextAreaTerrenoM2,
            },
            'Área do terreno',
            { allowNull: true }
          )
        : null,
      bodyKeys.includes('valor_condominio')
        ? validatePropertyNumericRange(
            parseDecimal(normalizedUpdateBody.valor_condominio),
            'Valor de condomínio',
            { max: MAX_PROPERTY_FEE, allowNull: true }
          )
        : null,
      bodyKeys.includes('valor_iptu')
        ? validatePropertyNumericRange(
            parseDecimal(normalizedUpdateBody.valor_iptu),
            'Valor de IPTU',
            { max: MAX_PROPERTY_FEE, allowNull: true }
          )
      : null,
    ].find(Boolean) as string | undefined;

    if (numericValidationError) {
      return sendPropertyError(req, res, 400, {
        error: numericValidationError,
        code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
        field: resolveValidationFieldFromMessage(numericValidationError),
      });
    }

    if (
      nextAreaConstruidaState != null &&
      nextAreaTerrenoState != null &&
      nextAreaConstruidaState > 0 &&
      nextAreaTerrenoState > 0 &&
      nextAreaConstruidaState > nextAreaTerrenoState
    ) {
      return sendPropertyError(req, res, 400, {
        error: 'Área construída não pode ser maior que a área do terreno.',
        code: PROPERTY_ERROR_CODES.AREA_RELATION_ERROR,
        field: 'area_terreno',
      });
    }

    if (
      nextPromotionPrice != null &&
      nextSalePrice != null &&
      Number(nextPromotionPrice) >= Number(nextSalePrice)
    ) {
      return sendPropertyError(req, res, 400, {
        error: 'Preço promocional de venda deve ser menor que o preço de venda.',
        code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
        field: 'promotion_price',
      });
    }

    if (
      nextPromotionalRentPrice != null &&
      nextRentPrice != null &&
      Number(nextPromotionalRentPrice) >= Number(nextRentPrice)
    ) {
      return sendPropertyError(req, res, 400, {
        error: 'Preço promocional de aluguel deve ser menor que o preço de aluguel.',
        code: PROPERTY_ERROR_CODES.NUMERIC_RANGE_ERROR,
        field: 'promotional_rent_price',
      });
    }

    if (
      nextPromotionPrice != null ||
      nextPromotionalRentPrice != null ||
      nextPromotionalRentPercentage != null ||
      nextPromotionPercentage != null
    ) {
      nextPromotionFlag = 1;
    }

    const previousPromotionNumericFlag = previousPromotionFlag ? 1 : 0;
    if (!bodyKeys.includes('is_promoted') && nextPromotionFlag !== previousPromotionNumericFlag) {
      fields.push('is_promoted = ?');
      values.push(nextPromotionFlag);
    }

    const wasRejected = property.status === 'rejected';
    if (wasRejected) {
      for (let i = fields.length - 1; i >= 0; i--) {
        if (fields[i] === 'status = ?') {
          fields.splice(i, 1);
          values.splice(i, 1);
        }
      }
      nextStatus = null;
    }

    const hasImageListUpdate = Array.isArray((body as { images?: unknown }).images);
    if (wasRejected && (fields.length > 0 || hasImageListUpdate)) {
      fields.push('status = ?', 'rejection_reason = ?', 'visibility = ?');
      values.push('pending_approval', null, 'HIDDEN');
    }

    if (fields.length === 0) {
      return sendPropertyError(req, res, 400, {
        error: 'Nenhum dado fornecido para atualizacao.',
        code: PROPERTY_ERROR_CODES.NO_UPDATE_DATA,
      });
    }

    values.push(propertyId);
    await runPropertyQuery(`UPDATE properties SET ${fields.join(', ')} WHERE id = ?`, values);

    if (Array.isArray(body.images) && property.status !== 'approved') {
      const images: string[] = body.images
        .filter((url: unknown) => typeof url === 'string' && url.trim().length > 0)
        .map((url: string) => url.trim());

      await runPropertyQuery('DELETE FROM property_images WHERE property_id = ?', [propertyId]);

      if (images.length > 0) {
        const imageValues = images.map((url) => [propertyId, url]);
        await runPropertyQuery('INSERT INTO property_images (property_id, image_url) VALUES ?', [
          imageValues,
        ]);
      }
    }

    const effectResult = await applyPropertyUpdateEffects({
      propertyId,
      property: {
        title: property.title,
        status: property.status as PropertyStatus,
        broker_id: property.broker_id != null ? Number(property.broker_id) : null,
        price_sale: property.price_sale != null ? Number(property.price_sale) : null,
        price_rent: property.price_rent != null ? Number(property.price_rent) : null,
        price: property.price != null ? Number(property.price) : null,
        commission_rate: property.commission_rate != null ? Number(property.commission_rate) : null,
        valor_iptu: property.valor_iptu != null ? Number(property.valor_iptu) : null,
        valor_condominio:
          property.valor_condominio != null ? Number(property.valor_condominio) : null,
      },
      body: body as Record<string, unknown>,
      brokerId,
      nextStatus,
      previousPromotionFlag,
      nextPromotionFlag,
      saleTouched,
      rentTouched,
      nextSalePrice,
      nextRentPrice,
      nextPromotionPercentage,
    });

    if (effectResult.kind === 'http_error') {
      return res.status(effectResult.statusCode).json(effectResult.body);
    }

    if (effectResult.kind === 'terminal') {
      return res.status(effectResult.statusCode).json(effectResult.body);
    }

    return res.status(200).json({ message: 'Imóvel atualizado com sucesso.' });
  } catch (error) {
    console.error('Erro ao atualizar imóvel:', error);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}

