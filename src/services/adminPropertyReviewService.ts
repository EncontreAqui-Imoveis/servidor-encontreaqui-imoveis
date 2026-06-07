import { ResultSetHeader, RowDataPacket } from 'mysql2';
import {
  ApplicationError,
  InternalError,
  InvalidInputError,
  NotFoundError,
} from '../errors/ApplicationError';
import { adminDb } from './adminPersistenceService';
import { notifyAdmins } from './notificationService';
import { notifyUsers, resolveUserNotificationRole } from './userNotificationService';
import { normalizePropertyAmenities } from '../utils/propertyAmenities';

interface PropertyDetailRow extends RowDataPacket {
  id: number;
  broker_id?: number | null;
  owner_id?: number | null;
  public_id?: string | null;
  public_code?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  code?: string | null;
  title: string;
  description?: string | null;
  type?: string | null;
  purpose?: string | null;
  status: string;
  is_promoted?: number | boolean | null;
  promotion_percentage?: number | string | null;
  promotional_rent_percentage?: number | string | null;
  promotion_start?: Date | string | null;
  promotion_end?: Date | string | null;
  price?: number | string | null;
  price_sale?: number | string | null;
  price_rent?: number | string | null;
  promotion_price?: number | string | null;
  promotional_rent_price?: number | string | null;
  promotionalPrice?: number | string | null;
  promotionalRentPrice?: number | string | null;
  promotionalRentPercentage?: number | string | null;
  address?: string | null;
  cep?: string | null;
  quadra?: string | null;
  lote?: string | null;
  numero?: string | null;
  bairro?: string | null;
  complemento?: string | null;
  city?: string | null;
  state?: string | null;
  sem_numero?: number | boolean | null;
  sem_quadra?: number | boolean | null;
  sem_lote?: number | boolean | null;
  sem_cep?: number | boolean | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  area_construida?: number | string | null;
  area_terreno?: number | string | null;
  area_construida_m2?: number | string | null;
  area_terreno_m2?: number | string | null;
  area_construida_valor?: number | string | null;
  area_construida_unidade?: string | null;
  area_terreno_valor?: number | string | null;
  area_terreno_unidade?: string | null;
  garage_spots?: number | string | null;
  valor_condominio?: number | string | null;
  valor_iptu?: number | string | null;
  video_url?: string | null;
  has_wifi?: number | boolean | null;
  tem_piscina?: number | boolean | null;
  tem_energia_solar?: number | boolean | null;
  tem_automacao?: number | boolean | null;
  tem_ar_condicionado?: number | boolean | null;
  eh_mobiliada?: number | boolean | null;
  amenities?: unknown;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  images?: string | string[] | null;
  broker_name?: string | null;
  broker_phone?: string | null;
  broker_status?: string | null;
  broker_creci?: string | null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: unknown): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value !== 0 ? 1 : 0;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'sim'].includes(text) ? 1 : 0;
}

function mapAdminProperty(row: PropertyDetailRow) {
  const images = Array.isArray(row.images)
    ? row.images
    : row.images
      ? String(row.images)
          .split(';')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((pair) => {
            const [id, url] = pair.split('|');
            const numId = Number(id);
            return { id: Number.isFinite(numId) ? numId : null, url };
          })
          .filter((item) => item.id !== null && item.url)
      : [];

  return {
    id: row.id,
    broker_id: row.broker_id ?? null,
    owner_id: row.owner_id ?? null,
    public_id: row.public_id ?? null,
    public_code: row.public_code ?? null,
    owner_name: row.owner_name ?? null,
    owner_phone: row.owner_phone ?? null,
    code: row.code ?? null,
    title: row.title,
    description: row.description ?? null,
    type: row.type ?? '',
    purpose: row.purpose ?? null,
    status: row.status as string,
    is_promoted: parseBoolean(row.is_promoted),
    promotion_percentage: toNullableNumber(row.promotion_percentage),
    promotional_rent_percentage: toNullableNumber(row.promotional_rent_percentage),
    promotion_start: row.promotion_start ? String(row.promotion_start) : null,
    promotion_end: row.promotion_end ? String(row.promotion_end) : null,
    price: toNullableNumber(row.price) ?? 0,
    price_sale: toNullableNumber(row.price_sale),
    price_rent: toNullableNumber(row.price_rent),
    promotion_price: toNullableNumber(row.promotion_price),
    promotional_rent_price: toNullableNumber(row.promotional_rent_price),
    promotionalPrice: toNullableNumber(row.promotion_price),
    promotionalRentPrice: toNullableNumber(row.promotional_rent_price),
    promotionalRentPercentage: toNullableNumber(row.promotional_rent_percentage),
    address: row.address ?? null,
    cep: row.cep ?? null,
    quadra: row.quadra ?? null,
    lote: row.lote ?? null,
    numero: row.numero ?? null,
    bairro: row.bairro ?? null,
    complemento: row.complemento ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    sem_numero: parseBoolean(row.sem_numero),
    sem_quadra: parseBoolean(row.sem_quadra),
    sem_lote: parseBoolean(row.sem_lote),
    sem_cep: parseBoolean(row.sem_cep),
    bedrooms: toNullableNumber(row.bedrooms),
    bathrooms: toNullableNumber(row.bathrooms),
    area_construida: toNullableNumber(row.area_construida),
    area_terreno: toNullableNumber(row.area_terreno),
    area_construida_m2: toNullableNumber(row.area_construida_m2),
    area_terreno_m2: toNullableNumber(row.area_terreno_m2),
    area_construida_valor: toNullableNumber(row.area_construida_valor),
    area_construida_unidade: row.area_construida_unidade ?? null,
    area_terreno_valor: toNullableNumber(row.area_terreno_valor),
    area_terreno_unidade: row.area_terreno_unidade ?? null,
    garage_spots: toNullableNumber(row.garage_spots),
    valor_condominio: toNullableNumber(row.valor_condominio),
    valor_iptu: toNullableNumber(row.valor_iptu),
    video_url: row.video_url ?? null,
    has_wifi: parseBoolean(row.has_wifi),
    tem_piscina: parseBoolean(row.tem_piscina),
    tem_energia_solar: parseBoolean(row.tem_energia_solar),
    tem_automacao: parseBoolean(row.tem_automacao),
    tem_ar_condicionado: parseBoolean(row.tem_ar_condicionado),
    eh_mobiliada: parseBoolean(row.eh_mobiliada),
    amenities: normalizePropertyAmenities(row.amenities),
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    images,
    broker_name: row.broker_name ?? null,
    broker_phone: row.broker_phone ?? null,
    broker_status: row.broker_status ?? null,
    broker_creci: row.broker_creci ?? null,
  };
}

async function fetchPropertyOwner(propertyId: number): Promise<{ ownerId: number | null; title: string }> {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    'SELECT broker_id, owner_id, title FROM properties WHERE id = ?',
    [propertyId],
  );
  if (!rows || rows.length === 0) {
    return { ownerId: null, title: '' };
  }
  const row = rows[0];
  const brokerId = row.broker_id != null ? Number(row.broker_id) : null;
  const ownerId = row.owner_id != null ? Number(row.owner_id) : null;
  const title = typeof row.title === 'string' ? row.title : '';
  const resolvedOwner = Number.isFinite(brokerId ?? NaN)
    ? brokerId
    : Number.isFinite(ownerId ?? NaN)
      ? ownerId
      : null;
  return { ownerId: resolvedOwner, title };
}

export async function getPropertyDetails(propertyId: number) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imovel inválido.');
  }

  try {
    const [rows] = await adminDb.query<PropertyDetailRow[]>(
      `
        SELECT
          p.*,
          ANY_VALUE(COALESCE(u.name, u_owner.name)) AS broker_name,
          ANY_VALUE(COALESCE(u.phone, u_owner.phone)) AS broker_phone,
          ANY_VALUE(b.status) AS broker_status,
          ANY_VALUE(b.creci) AS broker_creci
        FROM properties p
        LEFT JOIN brokers b ON p.broker_id = b.id
        LEFT JOIN users u ON u.id = b.id
        LEFT JOIN users u_owner ON u_owner.id = p.owner_id
        WHERE p.id = ?
        GROUP BY p.id
      `,
      [propertyId],
    );

    if (!rows || rows.length === 0) {
      throw new NotFoundError('Imóvel não encontrado.');
    }

    const property = rows[0];
    const [imageRows] = await adminDb.query<RowDataPacket[]>(
      `
        SELECT id, image_url
        FROM property_images
        WHERE property_id = ?
        ORDER BY id ASC
      `,
      [propertyId],
    );
    property.images = imageRows
      .map((row) => {
        const imageId = Number(row.id);
        const imageUrl = typeof row.image_url === 'string' ? row.image_url.trim() : '';
        if (!Number.isFinite(imageId) || imageUrl.length === 0) {
          return null;
        }
        return `${imageId}|${imageUrl}`;
      })
      .filter((item): item is string => Boolean(item));

    return mapAdminProperty(property);
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao buscar detalhes do imóvel:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}

export async function approveProperty(propertyId: number) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imovel inválido.');
  }

  try {
    const [result] = await adminDb.query<ResultSetHeader>(
      `UPDATE properties
       SET
         status = 'approved',
         visibility = 'PUBLIC',
         lifecycle_status = 'AVAILABLE',
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [propertyId],
    );

    if (result.affectedRows === 0) {
      throw new NotFoundError('Imovel não encontrado.');
    }
    try {
      await notifyAdmins(`Imovel #${propertyId} aprovado pelo admin.`, 'property', propertyId);
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre aprovação de imovel:', notifyError);
    }
    try {
      const { ownerId, title } = await fetchPropertyOwner(propertyId);
      if (ownerId) {
        const propertyLabel = title && title.trim().length > 0 ? title.trim() : 'sem titulo';
        const role = await resolveUserNotificationRole(ownerId);
        await notifyUsers({
          message: `Seu imovel "${propertyLabel}" foi aprovado e ja esta disponivel no app.`,
          recipientIds: [ownerId],
          recipientRole: role,
          relatedEntityType: 'property',
          relatedEntityId: propertyId,
        });
      }
    } catch (notifyError) {
      console.error('Erro ao notificar usuario sobre aprovacao do imovel:', notifyError);
    }

    return { message: 'Imóvel aprovado com sucesso.' };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao aprovar imóvel:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}

export async function rejectProperty(propertyId: number, reason: string) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imovel invalido.');
  }
  if (!reason) {
    throw new InvalidInputError('Informe o motivo da rejeicao.');
  }

  try {
    const { ownerId, title } = await fetchPropertyOwner(propertyId);
    if (!ownerId && !title) {
      throw new NotFoundError('Imovel nao encontrado.');
    }

    const [result] = await adminDb.query<ResultSetHeader>(
      `UPDATE properties
       SET
         status = 'rejected',
         visibility = 'HIDDEN',
         rejection_reason = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [reason, propertyId],
    );

    if (result.affectedRows === 0) {
      throw new NotFoundError('Imovel nao encontrado.');
    }
    try {
      await adminDb.query('DELETE FROM featured_properties WHERE property_id = ?', [propertyId]);
    } catch {
      /* legado */
    }

    const propertyLabel = title && title.trim().length > 0 ? title.trim() : 'sem titulo';
    const reasonPreview = reason.length > 200 ? `${reason.slice(0, 197).trimEnd()}...` : reason;

    try {
      await notifyAdmins(
        `Imovel #${propertyId} rejeitado. Motivo (resumo): ${reasonPreview}`,
        'property',
        propertyId,
      );
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre rejeicao de imovel:', notifyError);
    }
    try {
      if (ownerId) {
        const role = await resolveUserNotificationRole(ownerId);
        await notifyUsers({
          message: `Seu anuncio "${propertyLabel}" foi rejeitado. Resumo: ${reasonPreview} — edite e reenvie para analise em Meus imoveis.`,
          recipientIds: [ownerId],
          recipientRole: role,
          relatedEntityType: 'property',
          relatedEntityId: propertyId,
          pushAction: 'edit_rejected',
        });
      }
    } catch (notifyError) {
      console.error('Erro ao notificar usuario sobre rejeicao do imovel:', notifyError);
    }

    return {
      message: 'Imovel rejeitado. O anunciante pode corrigir e reenviar.',
      status: 'rejected',
    };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao rejeitar imovel:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}

export async function updatePropertyStatus(propertyId: number, status: unknown) {
  if (Number.isNaN(propertyId)) {
    throw new InvalidInputError('Identificador de imóvel invalido.');
  }

  if (typeof status !== 'string') {
    throw new InvalidInputError('Status inválido.');
  }

  const normalizedStatus = status.trim();
  const allowedStatuses = new Set(['pending_approval', 'approved', 'rejected', 'rented', 'sold']);

  if (!allowedStatuses.has(normalizedStatus)) {
    throw new InvalidInputError('Status de imóvel nao suportado.');
  }

  if (normalizedStatus === 'rejected') {
    return rejectProperty(propertyId, '');
  }

  try {
    const [result] = await adminDb.query<ResultSetHeader>(
      'UPDATE properties SET status = ? WHERE id = ?',
      [normalizedStatus, propertyId],
    );

    if (result.affectedRows === 0) {
      throw new NotFoundError('Imovel nao encontrado.');
    }

    try {
      await notifyAdmins(`Status do imovel #${propertyId} atualizado para ${normalizedStatus}.`, 'property', propertyId);
    } catch (notifyError) {
      console.error('Erro ao notificar admins sobre status de imovel:', notifyError);
    }
    if (normalizedStatus === 'approved' || normalizedStatus === 'rejected') {
      try {
        const { ownerId, title } = await fetchPropertyOwner(propertyId);
        if (ownerId) {
          const propertyLabel = title && title.trim().length > 0 ? title.trim() : 'sem titulo';
          const message =
            normalizedStatus === 'approved'
              ? `Seu imovel "${propertyLabel}" foi aprovado e ja esta disponivel no app.`
              : `Seu imovel "${propertyLabel}" foi rejeitado. Revise as informacoes e tente novamente.`;
          const role = await resolveUserNotificationRole(ownerId);
          await notifyUsers({
            message,
            recipientIds: [ownerId],
            recipientRole: role,
            relatedEntityType: 'property',
            relatedEntityId: propertyId,
          });
        }
      } catch (notifyError) {
        console.error('Erro ao notificar usuario sobre status do imovel:', notifyError);
      }
    }

    return {
      message: 'Status do imovel atualizado com sucesso.',
      status: normalizedStatus,
    };
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    console.error('Erro ao atualizar status do imovel:', error);
    throw new InternalError('Ocorreu um erro inesperado no servidor.');
  }
}
