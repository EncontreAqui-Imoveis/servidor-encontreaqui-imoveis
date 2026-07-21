import { RowDataPacket } from 'mysql2';

import connection from '../database/connection';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 15;
const MAX_SEARCH_LENGTH = 80;

export function normalizeLocationCatalogName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function parseLocationState(query: Record<string, unknown>): string | null {
  const state = String(query.state ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(state) ? state : null;
}

export type LocationPage<T> = {
  data: T[];
  page: number;
  limit: number;
  hasMore: boolean;
};

export type LocationCity = {
  id: number;
  name: string;
  state: string | null;
};

export type LocationNeighborhood = {
  id: number;
  cityId: number;
  name: string;
};

type CityRow = RowDataPacket & {
  id: number;
  name: string;
  state: string;
};

type NeighborhoodRow = RowDataPacket & {
  id: number;
  city_id: number;
  name: string;
};

export function parseLocationPagination(query: Record<string, unknown>) {
  const rawLimit = Number(query.limit ?? DEFAULT_LIMIT);
  const rawPage = Number(query.page ?? 1);
  const limit = Number.isInteger(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const page = Number.isInteger(rawPage) ? Math.max(rawPage, 1) : 1;
  const rawSearch = normalizeLocationCatalogName(query.search);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
    search: rawSearch.slice(0, MAX_SEARCH_LENGTH),
  };
}

function toLocationPage<T>(rows: T[], page: number, limit: number): LocationPage<T> {
  return {
    data: rows.slice(0, limit),
    page,
    limit,
    hasMore: rows.length > limit,
  };
}

export async function listLocationCities(
  query: Record<string, unknown>
): Promise<LocationPage<LocationCity>> {
  const { page, limit, offset, search } = parseLocationPagination(query);
  const state = parseLocationState(query);
  const conditions = ['normalized_name LIKE ?'];
  const values: Array<string | number> = [`${search}%`];
  if (state) {
    conditions.push('state = ?');
    values.push(state);
  }
  values.push(limit + 1, offset);
  const [rows] = await connection.query<CityRow[]>(
    `
      SELECT id, name, state
      FROM location_cities
      WHERE ${conditions.join(' AND ')}
      ORDER BY normalized_name ASC, state ASC, id ASC
      LIMIT ? OFFSET ?
    `,
    values
  );

  return toLocationPage(
    rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      state: String(row.state ?? '').trim() || null,
    })),
    page,
    limit
  );
}

export async function listLocationNeighborhoods(
  cityId: number,
  query: Record<string, unknown>
): Promise<LocationPage<LocationNeighborhood>> {
  const { page, limit, offset, search } = parseLocationPagination(query);
  const [rows] = await connection.query<NeighborhoodRow[]>(
    `
      SELECT id, city_id, name
      FROM location_neighborhoods
      WHERE city_id = ?
        AND normalized_name LIKE ?
      ORDER BY normalized_name ASC, id ASC
      LIMIT ? OFFSET ?
    `,
    [cityId, `${search}%`, limit + 1, offset]
  );

  return toLocationPage(
    rows.map((row) => ({
      id: Number(row.id),
      cityId: Number(row.city_id),
      name: String(row.name),
    })),
    page,
    limit
  );
}
