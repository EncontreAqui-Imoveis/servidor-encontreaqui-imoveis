import { Request, Response } from 'express';
import { ResultSetHeader } from 'mysql2';
import { adminDb } from './adminPersistenceService';
import { notifyAdmins } from './notificationService';
import { notifyPromotionStarted } from './priceDropNotificationService';
import { uploadToCloudinary } from '../config/cloudinary';
import { allocateNextPropertyCode } from '../utils/propertyCode';
import { areaInputToSquareMeters, getAreaUnitMax, parseAreaUnidade } from '../utils/propertyAreaUnits';
import { isOptionalBairroPropertyType } from '../utils/propertyTypes';
import { normalizePropertyType } from './adminControllerSupport';

const ALLOWED_STATUS = new Set(['pending_approval', 'approved', 'rejected', 'rented', 'sold']);
const PURPOSE_MAP: Record<string, string> = {
  venda: 'Venda',
  comprar: 'Venda',
  aluguel: 'Aluguel',
  alugar: 'Aluguel',
  vendaealuguel: 'Venda e Aluguel',
  vendaaluguel: 'Venda e Aluguel',
};
const ALLOWED_PURPOSES = new Set(['Venda', 'Aluguel', 'Venda e Aluguel']);
const MAX_IMAGES_PER_PROPERTY = 20;
const MAX_PROPERTY_DESCRIPTION_LENGTH = 500;
const MAX_GENERIC_PROPERTY_TEXT_LENGTH = 120;
const MAX_PROPERTY_COUNT = 99;
const MAX_PROPERTY_PRICE = 9999999999.99;
const MAX_PROPERTY_FEE = 99999999.99;
const IMAGE_UPLOAD_CONCURRENCY = 4;

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFD').replace(/[^\p{L}0-9]/gu, '').toLowerCase();
  const map: Record<string, string> = {
    pendingapproval: 'pending_approval',
    pendente: 'pending_approval',
    pending: 'pending_approval',
    aprovado: 'approved',
    aprovada: 'approved',
    approved: 'approved',
    rejeitado: 'rejected',
    rejeitada: 'rejected',
    rejected: 'rejected',
    alugado: 'rented',
    alugada: 'rented',
    rented: 'rented',
    vendido: 'sold',
    vendida: 'sold',
    sold: 'sold',
  };
  const status = map[normalized];
  return status && ALLOWED_STATUS.has(status) ? status : null;
}

function normalizePurpose(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFD').replace(/[^\p{L}0-9]/gu, '').toLowerCase();
  const mapped = PURPOSE_MAP[normalized];
  return mapped && ALLOWED_PURPOSES.has(mapped) ? mapped : null;
}

function parseDecimal(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseBoolean(value: unknown): 0 | 1 {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 0 ? 0 : 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'sim', 'on'].includes(normalized) ? 1 : 0;
  }
  return 0;
}

function parsePromotionPercentage(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
    throw new Error('Percentual de promocao invalido. Use valor entre 0 e 100.');
  }
  return Number(parsed.toFixed(2));
}

function parsePromotionDateTime(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Data de promocao invalida.');
  }
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

function stringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const textual = String(value).trim();
  return textual.length > 0 ? textual : null;
}

function normalizeCepForPersistence(value: unknown, semCepFlag: 0 | 1): string | null {
  if (semCepFlag === 1) return null;
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function validateRequiredBairro(bairro: unknown, propertyType: unknown): string | null {
  if (isOptionalBairroPropertyType(propertyType)) return null;
  return stringOrNull(bairro) ? null : 'Bairro é obrigatório.';
}

function hasValidPropertyDescription(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= MAX_PROPERTY_DESCRIPTION_LENGTH;
}

function validateMaxTextLength(value: unknown, label: string, maxLength = MAX_GENERIC_PROPERTY_TEXT_LENGTH): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    return `${label} deve ter no máximo ${maxLength} caracteres.`;
  }
  return null;
}

function validatePropertyNumericRange(
  value: number | null,
  label: string,
  options: { max: number; allowNull?: boolean },
): string | null {
  if (value == null) return options.allowNull ? null : `${label} inválido.`;
  if (value < 0) return `${label} inválido.`;
  if (value > options.max) return `${label} deve ser no máximo ${options.max}.`;
  return null;
}

function resolveAreaMaxByUnit(unidade: string): number | null {
  return getAreaUnitMax((parseAreaUnidade(unidade) as 'm2' | 'hectare' | 'alqueire'));
}

function validateAreaByInputUnit(
  value: number | null,
  unidade: string,
  label: string,
  allowNull: boolean,
): string | null {
  const max = resolveAreaMaxByUnit(unidade);
  if (max == null) return null;
  return validatePropertyNumericRange(value, label, { max, allowNull });
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [trimmed];
}

function parseImageUrlsInput(body: Record<string, unknown>): string[] {
  const fromArrayField = parseStringArray(body.image_urls);
  const fromBracketField = parseStringArray(body['image_urls[]']);
  return Array.from(new Set([...fromArrayField, ...fromBracketField]));
}

function isAllowedCloudinaryMediaUrl(urlValue: string, expectedFolder: string): boolean {
  try {
    const parsed = new URL(urlValue);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      return false;
    }
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) return false;
    if (!parsed.pathname.startsWith(`/${cloudName}/`)) {
      return false;
    }
    return parsed.pathname.includes(`/${expectedFolder}/`);
  } catch {
    return false;
  }
}

async function uploadImagesWithConcurrency(
  files: Express.Multer.File[],
  folder: string,
  concurrency = IMAGE_UPLOAD_CONCURRENCY,
): Promise<string[]> {
  if (files.length === 0) return [];

  const results: string[] = new Array(files.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= files.length) break;
      const uploaded = await uploadToCloudinary(files[currentIndex], folder);
      results[currentIndex] = uploaded.url;
    }
  });

  await Promise.all(workers);
  return results;
}

function normalizePropertyCode(code: unknown): string {
  const trimmed = String(code ?? '').trim();
  return trimmed.length > 0 ? trimmed : '';
}

export async function createAdminProperty(req: Request, res: Response) {
  const files = (req as any).files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const body = req.body ?? {};

  try {
    const required = [
      'title',
      'description',
      'type',
      'purpose',
      'address',
      'city',
      'state',
      'bedrooms',
      'bathrooms',
      'area_construida',
      'area_terreno',
      'garage_spots',
    ];
    for (const field of required) {
      if (!body[field]) {
        return res.status(400).json({ error: `Campo obrigatorio ausente: ${field}` });
      }
    }

    if (!hasValidPropertyDescription(body.description)) {
      return res.status(400).json({
        error: `Descrição deve ter entre 1 e ${MAX_PROPERTY_DESCRIPTION_LENGTH} caracteres.`,
      });
    }

    const {
      title,
      description,
      type,
      purpose,
      status,
      is_promoted,
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
      garage_spots,
      has_wifi,
      tem_piscina,
      tem_energia_solar,
      tem_automacao,
      tem_ar_condicionado,
      eh_mobiliada,
      valor_condominio,
      valor_iptu,
      video_url,
      broker_id,
      sem_quadra,
      sem_lote,
      area_construida_unidade,
      area_terreno_unidade,
    } = body;
    const semNumeroFlag = parseBoolean(sem_numero);
    const semQuadraFlag = parseBoolean(sem_quadra);
    const semLoteFlag = parseBoolean(sem_lote);
    const semCepFlag = parseBoolean(sem_cep);

    if (!semQuadraFlag && !String(quadra ?? '').trim()) {
      return res.status(400).json({ error: 'Informe a quadra ou marque a opção sem quadra.' });
    }
    if (!semLoteFlag && !String(lote ?? '').trim()) {
      return res.status(400).json({ error: 'Informe o lote ou marque a opção sem lote.' });
    }

    const normalizedType = normalizePropertyType(type);
    if (!normalizedType) {
      return res.status(400).json({ error: 'Tipo de imóvel inválido.' });
    }
    const requiredBairroError = validateRequiredBairro(bairro, normalizedType);
    if (requiredBairroError) {
      return res.status(400).json({ error: requiredBairroError });
    }

    const normalizedStatus = normalizeStatus(status) ?? 'approved';

    const normalizedPurpose = normalizePurpose(purpose);
    if (!normalizedPurpose) {
      return res.status(400).json({ error: 'Finalidade invalida.' });
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
      return res.status(400).json({ error: createTextValidationError });
    }

    const numericPrice = parseDecimal(price);
    const numericPriceSale = parseDecimal(price_sale);
    const numericPriceRent = parseDecimal(price_rent);

    let resolvedPrice: number | null = null;
    let resolvedPriceSale: number | null = null;
    let resolvedPriceRent: number | null = null;
    let resolvedPromotionPrice: number | null = null;
    let resolvedPromotionalRentPrice: number | null = null;
    let promotionPercentage: number | null = null;
    let promotionalRentPercentage: number | null = null;
    let promotionFlag: 0 | 1 = 0;
    let promotionStart: string | null = null;
    let promotionEnd: string | null = null;

    if (normalizedPurpose === 'Venda') {
      resolvedPriceSale = numericPriceSale ?? numericPrice;
      resolvedPrice = resolvedPriceSale;
    } else if (normalizedPurpose === 'Aluguel') {
      resolvedPriceRent = numericPriceRent ?? numericPrice;
      resolvedPrice = resolvedPriceRent;
    } else {
      resolvedPriceSale = numericPriceSale;
      resolvedPriceRent = numericPriceRent;
      resolvedPrice = resolvedPriceSale;
    }

    if (!resolvedPrice || resolvedPrice <= 0) {
      return res.status(400).json({ error: 'Preco invalido.' });
    }

    if (normalizedPurpose === 'Venda e Aluguel') {
      if (!resolvedPriceSale || resolvedPriceSale <= 0 || !resolvedPriceRent || resolvedPriceRent <= 0) {
        return res.status(400).json({ error: 'Informe os precos de venda e aluguel.' });
      }
    }

    resolvedPromotionPrice = parseDecimal(promotion_price ?? promotional_price);
    resolvedPromotionalRentPrice = parseDecimal(promotional_rent_price);
    try {
      promotionPercentage = parsePromotionPercentage(promotion_percentage);
      promotionalRentPercentage = parsePromotionPercentage(promotional_rent_percentage);
    } catch (parseError) {
      return res.status(400).json({ error: (parseError as Error).message });
    }

    if (normalizedPurpose === 'Venda') {
      resolvedPromotionalRentPrice = null;
      promotionalRentPercentage = null;
    } else if (normalizedPurpose === 'Aluguel') {
      resolvedPromotionPrice = null;
      promotionPercentage = null;
    }

    if (
      resolvedPromotionPrice == null &&
      promotionPercentage != null &&
      resolvedPriceSale != null
    ) {
      resolvedPromotionPrice = Number((resolvedPriceSale * (1 - promotionPercentage / 100)).toFixed(2));
    }

    if (
      resolvedPromotionalRentPrice == null &&
      promotionalRentPercentage != null &&
      resolvedPriceRent != null
    ) {
      resolvedPromotionalRentPrice = Number(
        (resolvedPriceRent * (1 - promotionalRentPercentage / 100)).toFixed(2)
      );
    }

    if (
      resolvedPromotionPrice != null &&
      resolvedPriceSale != null &&
      resolvedPromotionPrice >= resolvedPriceSale
    ) {
      return res.status(400).json({
        error: 'Preço promocional de venda deve ser menor que o preço de venda.',
      });
    }

    if (
      resolvedPromotionalRentPrice != null &&
      resolvedPriceRent != null &&
      resolvedPromotionalRentPrice >= resolvedPriceRent
    ) {
      return res.status(400).json({
        error: 'Preço promocional de aluguel deve ser menor que o preço de aluguel.',
      });
    }

    const numericBedrooms = parseInteger(bedrooms);
    const numericBathrooms = parseInteger(bathrooms);
    const numericGarageSpots = parseInteger(garage_spots);
    const areaConstruidaUnidade = parseAreaUnidade(
      typeof area_construida_unidade === 'string' ? area_construida_unidade : 'm2',
    );
    const areaTerrenoUnidade = parseAreaUnidade(
      typeof area_terreno_unidade === 'string' ? area_terreno_unidade : 'm2',
    );
    const rawAreaInput = parseDecimal(area_construida);
    let numericAreaConstruida: number | null = null;
    if (rawAreaInput != null) {
      const converted = areaInputToSquareMeters(rawAreaInput, areaConstruidaUnidade);
      if (Number.isNaN(converted)) {
        return res.status(400).json({ error: 'Área construída inválida.' });
      }
      numericAreaConstruida = converted;
    }
    const rawAreaTerrenoInput = parseDecimal(area_terreno);
    let numericAreaTerreno: number | null = null;
    if (rawAreaTerrenoInput != null) {
      const converted = areaInputToSquareMeters(rawAreaTerrenoInput, areaTerrenoUnidade);
      if (Number.isNaN(converted)) {
        return res.status(400).json({ error: 'Área do terreno inválida.' });
      }
      numericAreaTerreno = converted;
    }
    const numericValorCondominio = parseDecimal(valor_condominio);
    const numericValorIptu = parseDecimal(valor_iptu);
    const numericValidationError = [
      validatePropertyNumericRange(resolvedPrice, 'Preço base', { max: MAX_PROPERTY_PRICE }),
      validatePropertyNumericRange(resolvedPriceSale, 'Preço de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(resolvedPriceRent, 'Preço de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(resolvedPromotionPrice, 'Preço promocional de venda', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(resolvedPromotionalRentPrice, 'Preço promocional de aluguel', { max: MAX_PROPERTY_PRICE, allowNull: true }),
      validatePropertyNumericRange(numericBedrooms, 'Quartos', { max: MAX_PROPERTY_COUNT }),
      validatePropertyNumericRange(numericBathrooms, 'Banheiros', { max: MAX_PROPERTY_COUNT }),
      validatePropertyNumericRange(numericGarageSpots, 'Garagens', { max: MAX_PROPERTY_COUNT }),
      validateAreaByInputUnit(rawAreaInput, areaConstruidaUnidade, 'Área construída', true),
      validateAreaByInputUnit(rawAreaTerrenoInput, areaTerrenoUnidade, 'Área do terreno', false),
      validatePropertyNumericRange(numericValorCondominio, 'Valor de condomínio', { max: MAX_PROPERTY_FEE, allowNull: true }),
      validatePropertyNumericRange(numericValorIptu, 'Valor de IPTU', { max: MAX_PROPERTY_FEE, allowNull: true }),
    ].find(Boolean);

    if (numericValidationError) {
      return res.status(400).json({ error: numericValidationError });
    }
    const brokerIdValue = broker_id ? Number(broker_id) : null;

    const hasWifiFlag = parseBoolean(has_wifi);
    const temPiscinaFlag = parseBoolean(tem_piscina);
    const temEnergiaSolarFlag = parseBoolean(tem_energia_solar);
    const temAutomacaoFlag = parseBoolean(tem_automacao);
    const temArCondicionadoFlag = parseBoolean(tem_ar_condicionado);
    const ehMobiliadaFlag = parseBoolean(eh_mobiliada);
    try {
      promotionFlag = parseBoolean(is_promoted);
      promotionStart = parsePromotionDateTime(promotion_start);
      promotionEnd = parsePromotionDateTime(promotion_end);
      if (
        resolvedPromotionPrice != null ||
        resolvedPromotionalRentPrice != null ||
        promotionPercentage != null ||
        promotionalRentPercentage != null
      ) {
        promotionFlag = 1;
      }
      if (promotionFlag === 0) {
        promotionPercentage = null;
        promotionalRentPercentage = null;
        promotionStart = null;
        promotionEnd = null;
      }
    } catch (parseError) {
      return res.status(400).json({ error: (parseError as Error).message });
    }
    if (owner_phone && String(owner_phone).trim().length > 0 && !/^[0-9()+\-\s]{8,}$/.test(String(owner_phone))) {
      return res.status(400).json({ error: 'Telefone do proprietário inválido.' });
    }

    const semNumeroNormalized = semNumeroFlag === 1 ? null : stringOrNull(numero);

    if (
      numericBedrooms == null ||
      numericBathrooms == null ||
      numericGarageSpots == null ||
      numericAreaConstruida == null ||
      numericAreaTerreno == null
    ) {
      return res.status(400).json({ error: 'Campos numéricos obrigatórios inválidos.' });
    }

    const effectiveQuadra = semQuadraFlag ? null : stringOrNull(quadra);
    const effectiveLote = semLoteFlag ? null : stringOrNull(lote);

    const uploadImages = files?.images ?? [];
    const bodyRecord = body as Record<string, unknown>;
    const providedImageUrls = parseImageUrlsInput(bodyRecord).filter((url) =>
      isAllowedCloudinaryMediaUrl(url, 'conectimovel/properties/admin')
    );
    const uploadedImageUrls =
      uploadImages.length > 0
        ? await uploadImagesWithConcurrency(uploadImages, 'properties/admin')
        : [];
    const imageUrls = Array.from(new Set([...providedImageUrls, ...uploadedImageUrls]));
    if (imageUrls.length < 1) {
      return res.status(400).json({ error: 'Envie pelo menos 1 imagem do imóvel.' });
    }
    if (imageUrls.length > MAX_IMAGES_PER_PROPERTY) {
      return res.status(400).json({ error: `Limite máximo de ${MAX_IMAGES_PER_PROPERTY} imagens por imóvel.` });
    }

    let finalVideoUrl: string | null = null;
    const uploadVideos = files?.video ?? [];
    if (uploadVideos[0]) {
      const uploadedVideo = await uploadToCloudinary(uploadVideos[0], 'videos');
      finalVideoUrl = uploadedVideo.url;
    } else if (video_url && isAllowedCloudinaryMediaUrl(String(video_url), 'conectimovel/videos')) {
      finalVideoUrl = String(video_url);
    }

    const resolvedPropertyCode =
      normalizePropertyCode(code) || (await allocateNextPropertyCode());

    const [result] = await adminDb.query<ResultSetHeader>(
      `
        INSERT INTO properties (
          broker_id,
          title,
          description,
          type,
          purpose,
          status,
          is_promoted,
          promotion_percentage,
          promotion_start,
          promotion_end,
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
          garage_spots,
          has_wifi,
          tem_piscina,
          tem_energia_solar,
          tem_automacao,
          tem_ar_condicionado,
          eh_mobiliada,
          valor_condominio,
          valor_iptu,
          video_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        brokerIdValue,
        title,
        description,
        normalizedType,
        normalizedPurpose,
        normalizedStatus,
        promotionFlag,
        promotionPercentage,
        promotionStart,
        promotionEnd,
        resolvedPrice,
        resolvedPriceSale,
        resolvedPriceRent,
        resolvedPromotionPrice,
        resolvedPromotionalRentPrice,
        promotionalRentPercentage,
        resolvedPropertyCode,
        stringOrNull(owner_name),
        owner_phone ? String(owner_phone).trim() : null,
        address,
        effectiveQuadra,
        semQuadraFlag,
        effectiveLote,
        semLoteFlag,
        semNumeroNormalized,
        stringOrNull(bairro),
        stringOrNull(complemento),
        city,
        state,
        normalizeCepForPersistence(cep, semCepFlag),
        semCepFlag,
        numericBedrooms,
        numericBathrooms,
        numericAreaConstruida,
        areaConstruidaUnidade,
        numericAreaTerreno,
        numericGarageSpots,
        hasWifiFlag,
        temPiscinaFlag,
        temEnergiaSolarFlag,
        temAutomacaoFlag,
        temArCondicionadoFlag,
        ehMobiliadaFlag,
        numericValorCondominio,
        numericValorIptu,
        finalVideoUrl,
      ],
    );

    const propertyId = result.insertId;

    if (imageUrls.length > 0) {
      const values = imageUrls.map((url) => [propertyId, url]);
      await adminDb.query('INSERT INTO property_images (property_id, image_url) VALUES ?', [values]);
    }

    if (promotionFlag === 1) {
      try {
        await notifyPromotionStarted({
          propertyId,
          propertyTitle: title,
          promotionPercentage,
        });
      } catch (promotionNotifyError) {
        console.error('Erro ao notificar favoritos sobre promocao (create admin):', promotionNotifyError);
      }
    }

    try {
      await notifyAdmins(
        `Um novo imovel '${title}' foi criado pelo admin.`,
        'property',
        propertyId,
      );
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre novo imovel:', notifyError);
    }

    return res.status(201).json({
      message: 'Imovel criado com sucesso!',
      propertyId,
      images: imageUrls,
      video: finalVideoUrl,
      status: normalizedStatus,
    });
  } catch (error) {
    console.error('Erro ao criar imovel pelo admin:', error);
    const knownError = error as { statusCode?: number; message?: string };
    if (knownError?.statusCode === 413) {
      return res.status(413).json({
        error:
          knownError.message ||
          'Arquivo muito grande para upload. Reduza o tamanho do arquivo e tente novamente.',
      });
    }
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
}
