import { RowDataPacket } from 'mysql2';
import { adminDb } from './adminPersistenceService';
import { runFeaturedPropertiesScopeMigration } from '../database/migrations';

type Nullable<T> = T | null;

export interface PropertiesWithBrokersQuery {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
  searchColumn?: unknown;
  status?: unknown;
  city?: unknown;
  purpose?: unknown;
  paginate?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
}

export interface ArchivedPropertiesQuery {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
  status?: unknown;
}

export interface FeaturedPropertiesUpdateBody {
  propertyIds?: unknown;
  salePropertyIds?: unknown;
  rentPropertyIds?: unknown;
}

export type PropertiesWithBrokersPayload = {
  data: RowDataPacket[];
  total: number;
};

export type ArchivedPropertiesPayload = {
  data: Array<{
    id: number;
    code: string | null;
    title: string | null;
    status: string | null;
    brokerName: string | null;
    transactionDate: string | null;
  }>;
  total: number;
  page: number;
  limit: number;
};

export type FeaturedPropertiesPayload = {
  data: {
    sale: Array<Record<string, unknown>>;
    rent: Array<Record<string, unknown>>;
  };
};

export type FeaturedPropertiesUpdatePayload = {
  data: {
    sale: number[];
    rent: number[];
  };
};

export type RelistPropertyPayload = {
  message: string;
  data: {
    id: number;
    code: string | null;
    title: string | null;
    status: 'approved';
  };
};

function normalizeStatus(value: unknown): Nullable<string> {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .normalize('NFD')
    .replace(/[^\p{L}0-9]/gu, '')
    .toLowerCase();
  const map: Record<string, string> = {
    pendingapproval: 'pending_approval',
    pendente: 'pending_approval',
    pending: 'pending_approval',
    pendenteaprovacao: 'pending_approval',
    aprovado: 'approved',
    approved: 'approved',
    aprovada: 'approved',
    rejected: 'rejected',
    rejeitado: 'rejected',
    rejeitada: 'rejected',
    rented: 'rented',
    alugado: 'rented',
    alugada: 'rented',
    locado: 'rented',
    locada: 'rented',
    sold: 'sold',
    vendido: 'sold',
    vendida: 'sold',
  };
  const allowed = new Set(['pending_approval', 'approved', 'rejected', 'rented', 'sold']);
  const status = map[normalized];
  return status && allowed.has(status) ? status : null;
}

function parsePage(value: unknown, defaultValue: number): number {
  return Math.max(parseInt(String(value ?? defaultValue), 10) || defaultValue, 1);
}

function parseLimit(value: unknown, defaultValue: number): number {
  return Math.min(Math.max(parseInt(String(value ?? defaultValue), 10) || defaultValue, 1), 100);
}

function toIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function purposeKey(p: string | null | undefined): { sale: boolean; rent: boolean } {
  const t = String(p ?? '').trim();
  return {
    sale: t === 'Venda' || t === 'Venda e Aluguel',
    rent: t === 'Aluguel' || t === 'Venda e Aluguel',
  };
}

export async function listPropertiesWithBrokers(
  query: PropertiesWithBrokersQuery,
): Promise<PropertiesWithBrokersPayload> {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 10);
  const offset = (page - 1) * limit;
  const searchTerm = String(query.search ?? '').trim();
  const requestedSearchColumn = String(query.searchColumn ?? '').trim();
  const status = normalizeStatus(query.status);
  const city = String(query.city ?? '').trim();
  const purpose = String(query.purpose ?? '').trim().toLowerCase();
  const paginate = String(query.paginate ?? 'true').trim().toLowerCase() !== 'false';
  const sortBy = String(query.sortBy ?? 'p.created_at');
  const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const allowedSearchColumns = new Set(['p.id', 'p.title', 'p.type', 'p.city', 'p.code', 'u.name', 'u_owner.name']);
  const allowedSortColumns = new Set([
    'p.id',
    'p.title',
    'p.type',
    'p.city',
    'u.name',
    'u_owner.name',
    'p.price',
    'p.created_at',
    'p.code',
    'p.status',
  ]);

  const narrowSearchColumn = allowedSearchColumns.has(requestedSearchColumn)
    ? requestedSearchColumn
    : null;
  const safeSortBy = allowedSortColumns.has(sortBy) ? sortBy : 'p.created_at';

  const whereClauses: string[] = [];
  const params: any[] = [];

  if (searchTerm) {
    if (narrowSearchColumn) {
      if (
        narrowSearchColumn === 'p.code' &&
        /^\d+$/.test(searchTerm) &&
        Number.isFinite(Number(searchTerm))
      ) {
        const codeNum = Number(searchTerm);
        whereClauses.push(
          `(${narrowSearchColumn} LIKE ? OR (COALESCE(p.code,'') REGEXP '^[0-9]+$' AND CAST(p.code AS UNSIGNED) = ?))`,
        );
        params.push(`%${searchTerm}%`, codeNum);
      } else {
        whereClauses.push(`${narrowSearchColumn} LIKE ?`);
        params.push(`%${searchTerm}%`);
      }
    } else {
      const like = `%${searchTerm}%`;
      const parts = [
        'p.title LIKE ?',
        'p.city LIKE ?',
        'CAST(p.id AS CHAR) LIKE ?',
        "COALESCE(p.code,'') LIKE ?",
        'p.type LIKE ?',
        "COALESCE(u.name,'') LIKE ?",
        "COALESCE(u_owner.name,'') LIKE ?",
      ];
      const searchParams: unknown[] = [like, like, like, like, like, like, like];
      if (/^\d+$/.test(searchTerm)) {
        const idNum = Number(searchTerm);
        if (Number.isFinite(idNum)) {
          parts.push('p.id = ?');
          searchParams.push(idNum);
          parts.push("(COALESCE(p.code,'') REGEXP '^[0-9]+$' AND CAST(p.code AS UNSIGNED) = ?)");
          searchParams.push(idNum);
        }
      }
      whereClauses.push(`(${parts.join(' OR ')})`);
      params.push(...searchParams);
    }
  }

  if (status) {
    whereClauses.push('p.status = ?');
    params.push(status);
  }

  if (city) {
    whereClauses.push("LOWER(TRIM(COALESCE(p.city, ''))) = LOWER(TRIM(?))");
    params.push(city);
  }

  if (purpose) {
    if (purpose.includes('vend')) {
      whereClauses.push("LOWER(COALESCE(p.purpose, '')) LIKE ?");
      params.push('%vend%');
    } else if (purpose.includes('alug')) {
      whereClauses.push("LOWER(COALESCE(p.purpose, '')) LIKE ?");
      params.push('%alug%');
    }
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [totalRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM properties p
      LEFT JOIN brokers b ON p.broker_id = b.id
      LEFT JOIN users u ON b.id = u.id
      LEFT JOIN users u_owner ON u_owner.id = p.owner_id
      ${where}
    `,
    params,
  );
  const total = totalRows[0]?.total ?? 0;

  const dataQuery = `
      SELECT
        p.id,
        p.code,
        p.title,
        p.type,
        p.status,
        p.price,
        p.price_sale,
        p.price_rent,
        p.promotion_percentage,
        p.promotion_price,
        p.promotional_rent_price,
        p.promotional_rent_percentage,
        p.city,
        p.state,
        p.bairro,
        p.cep,
        p.purpose,
        p.updated_at,
        p.area_construida,
        p.area_construida_unidade,
        p.area_construida_valor,
        p.area_construida_m2,
        p.area_terreno,
        p.area_terreno_unidade,
        p.area_terreno_valor,
        p.area_terreno_m2,
        p.amenities,
        p.has_wifi,
        p.tem_piscina,
        p.tem_energia_solar,
        p.tem_automacao,
        p.tem_ar_condicionado,
        p.eh_mobiliada,
        p.created_at,
        p.broker_id,
        p.owner_id,
        p.owner_name,
        p.owner_phone,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = p.id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image_url,
        COALESCE(u.name, u_owner.name) AS broker_name,
        COALESCE(u.phone, u_owner.phone) AS broker_phone,
        b.status AS broker_status,
        b.creci AS broker_creci
      FROM properties p
      LEFT JOIN brokers b ON p.broker_id = b.id
      LEFT JOIN users u ON b.id = u.id
      LEFT JOIN users u_owner ON u_owner.id = p.owner_id
      ${where}
      ORDER BY ${safeSortBy} ${sortOrder}
      ${paginate ? 'LIMIT ? OFFSET ?' : ''}
    `;

  const dataParams = paginate ? [...params, limit, offset] : params;
  const [rows] = await adminDb.query<RowDataPacket[]>(dataQuery, dataParams);

  return { data: rows, total };
}

export async function listArchivedProperties(
  query: ArchivedPropertiesQuery,
): Promise<ArchivedPropertiesPayload> {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 10);
  const offset = (page - 1) * limit;
  const search = String(query.search ?? '').trim();
  const statusFilter = String(query.status ?? '').trim().toLowerCase();

  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (statusFilter === 'sold' || statusFilter === 'rented') {
    whereClauses.push('p.status = ?');
    params.push(statusFilter);
  } else {
    whereClauses.push("p.status IN ('sold', 'rented')");
  }

  if (search) {
    const like = `%${search}%`;
    const parts = [
      'p.code LIKE ?',
      'p.title LIKE ?',
      'COALESCE(u.name, u_owner.name) LIKE ?',
      'CAST(p.id AS CHAR) LIKE ?',
    ];
    const searchParams: Array<string | number> = [like, like, like, like];
    if (/^\d+$/.test(search)) {
      const idNum = Number(search);
      if (Number.isFinite(idNum)) {
        parts.push('p.id = ?');
        searchParams.push(idNum);
      }
    }
    whereClauses.push(`(${parts.join(' OR ')})`);
    params.push(...searchParams);
  }

  const where = `WHERE ${whereClauses.join(' AND ')}`;

  const [countRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM properties p
      LEFT JOIN brokers b ON b.id = p.broker_id
      LEFT JOIN users u ON u.id = b.id
      LEFT JOIN users u_owner ON u_owner.id = p.owner_id
      ${where}
    `,
    params,
  );
  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        p.id,
        p.code,
        p.title,
        p.status,
        COALESCE(u.name, u_owner.name) AS broker_name,
        sl.last_sale_date AS transaction_date
      FROM properties p
      LEFT JOIN brokers b ON b.id = p.broker_id
      LEFT JOIN users u ON u.id = b.id
      LEFT JOIN users u_owner ON u_owner.id = p.owner_id
      LEFT JOIN (
        SELECT property_id, MAX(sale_date) AS last_sale_date
        FROM sales
        GROUP BY property_id
      ) sl ON sl.property_id = p.id
      ${where}
      ORDER BY COALESCE(sl.last_sale_date, p.created_at) DESC, p.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset],
  );

  return {
    data: rows.map((row) => ({
      id: Number(row.id),
      code: row.code ?? null,
      title: row.title ?? null,
      status: row.status ?? null,
      brokerName: row.broker_name ?? null,
      transactionDate: row.transaction_date ? String(row.transaction_date) : null,
    })),
    total,
    page,
    limit,
  };
}

export async function listFeaturedProperties(): Promise<FeaturedPropertiesPayload> {
  await runFeaturedPropertiesScopeMigration();
  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        fp.property_id AS id,
        fp.position,
        fp.scope,
        p.title,
        p.city,
        p.state,
        p.status,
        p.price,
        p.price_sale,
        p.price_rent,
        p.promotion_price,
        p.promotional_rent_price,
        p.promotional_rent_percentage,
        p.purpose
      FROM featured_properties fp
      JOIN properties p ON p.id = fp.property_id
      ORDER BY fp.scope ASC, fp.position ASC
    `,
  );
  const list = (rows as RowDataPacket[]).map((row) => ({
    id: Number(row.id),
    position: Number(row.position),
    scope: String(row.scope ?? 'sale') === 'rent' ? 'rent' : 'sale',
    title: row.title,
    city: row.city,
    state: row.state,
    status: row.status,
    price: row.price,
    price_sale: row.price_sale,
    price_rent: row.price_rent,
    promotion_price: row.promotion_price,
    promotional_rent_price: row.promotional_rent_price,
    promotional_rent_percentage: row.promotional_rent_percentage,
    purpose: row.purpose,
  }));
  return {
    data: {
      sale: list.filter((r) => r.scope === 'sale'),
      rent: list.filter((r) => r.scope === 'rent'),
    },
  };
}

export async function updateFeaturedProperties(
  body: FeaturedPropertiesUpdateBody,
): Promise<FeaturedPropertiesUpdatePayload> {
  const MAX_PER_SCOPE = 20;
  let saleIds: number[] = toIdList(body.salePropertyIds);
  let rentIds: number[] = toIdList(body.rentPropertyIds);

  if (saleIds.length === 0 && rentIds.length === 0 && Array.isArray(body.propertyIds)) {
    saleIds = toIdList(body.propertyIds);
  }

  if (saleIds.length > MAX_PER_SCOPE || rentIds.length > MAX_PER_SCOPE) {
    throw new Error(`Limite maximo de ${MAX_PER_SCOPE} destaques por vitrine (venda ou aluguel).`);
  }

  const allCheck = [...new Set([...saleIds, ...rentIds])];
  if (allCheck.length > 0) {
    const [approvedRows] = await adminDb.query<RowDataPacket[]>(
      'SELECT id, purpose FROM properties WHERE status = ? AND id IN (?)',
      ['approved', allCheck],
    );
    const byId = new Map<number, { purpose: string | null }>();
    for (const row of approvedRows) {
      byId.set(Number(row.id), { purpose: row.purpose != null ? String(row.purpose) : null });
    }
    const notApproved: number[] = allCheck.filter((id) => !byId.has(id));
    if (notApproved.length > 0) {
      const error = new Error('Alguns imoveis não estão aprovados.');
      (error as Error & { invalidIds?: number[] }).invalidIds = notApproved;
      throw error;
    }
    const wrongScope: { id: number; scope: string }[] = [];
    for (const id of saleIds) {
      const pr = byId.get(id)?.purpose;
      if (!purposeKey(pr).sale) wrongScope.push({ id, scope: 'sale' });
    }
    for (const id of rentIds) {
      const pr = byId.get(id)?.purpose;
      if (!purposeKey(pr).rent) wrongScope.push({ id, scope: 'rent' });
    }
    if (wrongScope.length > 0) {
      const error = new Error('Finalidade do imóvel não compatível com a vitrine selecionada (venda ou aluguel).');
      (error as Error & { invalidScope?: typeof wrongScope }).invalidScope = wrongScope;
      throw error;
    }
  }

  const db = await adminDb.getConnection();
  try {
    await db.beginTransaction();
    await db.query('DELETE FROM featured_properties');
    const values: [number, string, number][] = [
      ...saleIds.map((id, index) => [id, 'sale', index + 1] as [number, string, number]),
      ...rentIds.map((id, index) => [id, 'rent', index + 1] as [number, string, number]),
    ];
    if (values.length > 0) {
      await db.query('INSERT INTO featured_properties (property_id, scope, position) VALUES ?', [values]);
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }

  return { data: { sale: saleIds, rent: rentIds } };
}

export async function relistProperty(propertyId: number): Promise<RelistPropertyPayload> {
  const db = await adminDb.getConnection();
  try {
    await db.beginTransaction();

    const [rows] = await db.query<RowDataPacket[]>(
      `
        SELECT id, status, code, title
        FROM properties
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [propertyId],
    );

    if (!rows.length) {
      await db.rollback();
      throw new Error('Imóvel não encontrado.');
    }

    const property = rows[0];
    const currentStatus = String(property.status ?? '').toLowerCase();
    if (currentStatus !== 'rented' && currentStatus !== 'sold') {
      await db.rollback();
      throw new Error('Apenas imóveis vendidos ou alugados podem ser disponibilizados novamente.');
    }

    await db.query(
      `
        UPDATE properties
        SET
          status = 'approved',
          sale_value = NULL,
          commission_rate = NULL,
          commission_value = NULL
        WHERE id = ?
      `,
      [propertyId],
    );

    const dealType = currentStatus === 'rented' ? 'rent' : 'sale';
    await db.query(
      `
        DELETE FROM sales
        WHERE property_id = ?
          AND deal_type = ?
      `,
      [propertyId, dealType],
    );

    await db.commit();
    return {
      message: 'Imóvel disponibilizado novamente com sucesso.',
      data: {
        id: Number(property.id),
        code: property.code ?? null,
        title: property.title ?? null,
        status: 'approved',
      },
    };
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    db.release();
  }
}
