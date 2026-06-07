import { RowDataPacket } from 'mysql2';
import { adminDb } from './adminPersistenceService';

export interface AdminUsersQuery {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
  includeBrokers?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
}

export interface AdminBrokersQuery {
  page?: unknown;
  limit?: unknown;
  status?: unknown;
  search?: unknown;
  sortBy?: unknown;
  sortOrder?: unknown;
}

function parsePage(value: unknown, defaultValue: number): number {
  return Math.max(parseInt(String(value ?? defaultValue), 10) || defaultValue, 1);
}

function parseLimit(value: unknown, defaultValue: number): number {
  return Math.min(Math.max(parseInt(String(value ?? defaultValue), 10) || defaultValue, 1), 100);
}

export async function listAdminUsers(query: AdminUsersQuery) {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 10);
  const offset = (page - 1) * limit;
  const searchTerm = String(query.search ?? '').trim();
  const includeBrokers = String(query.includeBrokers ?? '').toLowerCase() === 'true';
  const sortByParam = String(query.sortBy ?? '').toLowerCase();
  const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const sortMap: Record<string, string> = {
    name: 'u.name',
    email: 'u.email',
    created_at: 'u.created_at',
  };
  const sortBy = sortMap[sortByParam] ?? 'u.created_at';

  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (!includeBrokers) {
    whereClauses.push("(b.id IS NULL OR b.status IN ('rejected'))");
  }

  if (searchTerm) {
    whereClauses.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${searchTerm}%`, `%${searchTerm}%`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [totalRows] = await adminDb.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users u LEFT JOIN brokers b ON u.id = b.id ${whereSql}`,
    params,
  );
  const total = totalRows[0]?.total ?? 0;

  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.created_at,
        b.creci,
        CASE
          WHEN b.id IS NOT NULL AND b.status IN ('approved','pending_verification') THEN 'broker'
          ELSE 'client'
        END AS role
      FROM users u
      LEFT JOIN brokers b ON u.id = b.id
      ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset],
  );

  return { data: rows, total };
}

export async function listAdminClients() {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT u.id, u.name, u.email, u.phone, u.created_at
      FROM users u
      LEFT JOIN brokers b ON u.id = b.id
      WHERE b.id IS NULL OR b.status = 'rejected'
    `,
  );

  return { data: rows, total: rows.length };
}

export async function getAdminClientById(clientId: number) {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        u.phone,
        u.street,
        u.number,
        u.complement,
        u.bairro,
        u.city,
        u.state,
        u.cep,
        u.created_at
      FROM users u
      LEFT JOIN brokers b ON u.id = b.id
      WHERE u.id = ? AND (b.id IS NULL OR b.status = 'rejected')
      LIMIT 1
    `,
    [clientId],
  );

  return rows?.[0] ?? null;
}

export async function listPendingAdminBrokers() {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        b.id,
        u.name,
        u.email,
        u.phone,
        b.creci,
        b.status,
        bd.creci_front_url,
        bd.creci_back_url,
        bd.selfie_url,
        bd.status AS document_status,
        b.created_at
      FROM brokers b
      INNER JOIN users u ON b.id = u.id
      INNER JOIN broker_documents bd
        ON b.id = bd.broker_id
        AND bd.status IN ('pending', 'rejected')
        AND NULLIF(TRIM(bd.creci_front_url), '') IS NOT NULL
        AND NULLIF(TRIM(bd.creci_back_url), '') IS NOT NULL
        AND NULLIF(TRIM(bd.selfie_url), '') IS NOT NULL
      WHERE b.status = 'pending_verification'
    `,
  );

  return { data: rows };
}

export async function listAdminBrokers(query: AdminBrokersQuery) {
  const page = parsePage(query.page, 1);
  const limit = parseLimit(query.limit, 10);
  const offset = (page - 1) * limit;

  const requestedStatusRaw = String(query.status ?? '').trim();
  const requestedStatus = requestedStatusRaw.length === 0 ? 'approved' : requestedStatusRaw;
  const searchTerm = String(query.search ?? '').trim();
  const allowedStatuses = new Set(['pending_verification', 'approved', 'rejected', 'all']);
  const whereClauses: string[] = [];
  const params: Array<string | number> = [];

  if (requestedStatus && allowedStatuses.has(requestedStatus)) {
    if (requestedStatus !== 'all') {
      whereClauses.push('b.status = ?');
      params.push(requestedStatus);
    }
  } else if (requestedStatusRaw.length > 0) {
    throw new Error('Status de corretor inválido.');
  }

  if (searchTerm) {
    whereClauses.push('(u.name LIKE ? OR u.email LIKE ? OR b.creci LIKE ?)');
    params.push(`%${searchTerm}%`, `%${searchTerm}%`, `%${searchTerm}%`);
  }

  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const sortMap: Record<string, string> = {
    name: 'u.name',
    property_count: 'property_count',
    created_at: 'b.created_at',
    status: 'b.status',
    creci: 'b.creci',
  };
  const sortByParam = String(query.sortBy ?? '').toLowerCase();
  const sortBy = sortMap[sortByParam] ?? 'b.created_at';
  const sortOrder = String(query.sortOrder ?? 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const [totalRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(DISTINCT b.id) AS total
      FROM brokers b
      INNER JOIN users u ON b.id = u.id
      ${where}
    `,
    params,
  );
  const total = totalRows[0]?.total ?? 0;

  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        b.id,
        u.name,
        u.email,
        u.phone,
        b.creci,
        b.status,
        b.created_at,
        a.id AS agency_id,
        a.name AS agency_name,
        a.logo_url AS agency_logo_url,
        a.address AS agency_address,
        a.city AS agency_city,
        a.state AS agency_state,
        a.phone AS agency_phone,
        a.email AS agency_email,
        bd.creci_front_url,
        bd.creci_back_url,
        bd.selfie_url,
        COUNT(p.id) AS property_count
      FROM brokers b
      INNER JOIN users u ON b.id = u.id
      LEFT JOIN agencies a ON b.agency_id = a.id
      LEFT JOIN broker_documents bd ON bd.broker_id = b.id
      LEFT JOIN properties p ON p.broker_id = b.id
      ${where}
      GROUP BY
        b.id,
        u.name,
        u.email,
        u.phone,
        b.creci,
        b.status,
        b.created_at,
        a.id,
        a.name,
        a.logo_url,
        a.address,
        a.city,
        a.state,
        a.phone,
        a.email,
        bd.creci_front_url,
        bd.creci_back_url,
        bd.selfie_url
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset],
  );

  const data = (rows as any[]).map((row) => ({
    ...row,
    documents: {
      creci_front_url: row.creci_front_url ?? null,
      creci_back_url: row.creci_back_url ?? null,
      selfie_url: row.selfie_url ?? null,
    },
  }));

  return { data, total };
}

export async function getAdminBrokerById(brokerId: number) {
  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        b.id,
        u.name,
        u.email,
        u.phone,
        u.street,
        u.number,
        u.complement,
        u.bairro,
        u.city,
        u.state,
        u.cep,
        u.created_at,
        b.creci,
        b.status,
        b.agency_id,
        bd.creci_front_url,
        bd.creci_back_url,
        bd.selfie_url,
        bd.status as document_status
      FROM brokers b
      INNER JOIN users u ON b.id = u.id
      LEFT JOIN broker_documents bd ON b.id = bd.broker_id
      WHERE b.id = ?
      LIMIT 1
    `,
    [brokerId],
  );

  return rows?.[0] ?? null;
}

export async function getAdminBrokerProperties(brokerId: number) {
  const [properties] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        p.id,
        p.title,
        p.status,
        p.type,
        p.purpose,
        p.price,
        p.price_sale,
        p.price_rent,
        p.promotion_price,
        p.promotional_rent_price,
        p.promotional_rent_percentage,
        p.address,
        p.city,
        p.state,
        p.created_at
      FROM properties p
      WHERE p.broker_id = ?
      ORDER BY p.created_at DESC
    `,
    [brokerId],
  );

  return { data: properties };
}

export async function getAdminClientProperties(clientId: number) {
  const [properties] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        p.id,
        p.title,
        p.status,
        p.type,
        p.purpose,
        p.price,
        p.price_sale,
        p.price_rent,
        p.promotion_price,
        p.promotional_rent_price,
        p.promotional_rent_percentage,
        p.address,
        p.city,
        p.state,
        p.created_at
      FROM properties p
      WHERE p.owner_id = ?
      ORDER BY p.created_at DESC
    `,
    [clientId],
  );

  return { data: properties };
}
