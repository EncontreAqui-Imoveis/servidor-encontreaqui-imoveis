import fs from 'fs';
import path from 'path';

import { RowDataPacket } from 'mysql2';

import connection from '../database/connection';

import { normalizeLocationCatalogName } from './locationCatalogService';

type LocationCatalogSource = {
  estados?: Array<{
    sigla?: unknown;
    cidades?: unknown;
  }>;
};

type LocationCatalogCity = {
  name: string;
  state: string;
  normalizedName: string;
};

type CountRow = RowDataPacket & {
  total: number;
};

const CATALOG_FILE_NAME = 'estados-cidade.json';
const INSERT_CHUNK_SIZE = 400;

function resolveCatalogFilePath(): string {
  const workingDirectoryPath = path.resolve(process.cwd(), CATALOG_FILE_NAME);
  if (fs.existsSync(workingDirectoryPath)) {
    return workingDirectoryPath;
  }
  return path.resolve(__dirname, '../../', CATALOG_FILE_NAME);
}

export function loadBrazilianCityCatalog(filePath = resolveCatalogFilePath()): LocationCatalogCity[] {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as LocationCatalogSource;
  const cities = new Map<string, LocationCatalogCity>();

  for (const stateEntry of parsed.estados ?? []) {
    const state = String(stateEntry.sigla ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state) || !Array.isArray(stateEntry.cidades)) {
      continue;
    }

    for (const rawCity of stateEntry.cidades) {
      const name = String(rawCity ?? '').trim();
      const normalizedName = normalizeLocationCatalogName(name);
      if (!name || !normalizedName) {
        continue;
      }
      cities.set(`${state}:${normalizedName}`, { name, state, normalizedName });
    }
  }

  return [...cities.values()].sort(
    (left, right) =>
      left.state.localeCompare(right.state) || left.normalizedName.localeCompare(right.normalizedName)
  );
}

/**
 * Loads the versioned national municipality catalog once on boot. The catalog is
 * safe to re-run: existing city ids are preserved and only display names are refreshed.
 */
export async function ensureBrazilianCityCatalogSeeded(): Promise<number> {
  const catalog = loadBrazilianCityCatalog();
  if (catalog.length === 0) {
    throw new Error('O catalogo nacional de municipios esta vazio.');
  }

  const [countRows] = await connection.query<CountRow[]>(
    'SELECT COUNT(*) AS total FROM location_cities'
  );
  const existingCount = Number(countRows[0]?.total ?? 0);
  if (existingCount >= catalog.length) {
    return 0;
  }

  for (let index = 0; index < catalog.length; index += INSERT_CHUNK_SIZE) {
    const chunk = catalog.slice(index, index + INSERT_CHUNK_SIZE);
    const values = chunk.map((city) => [city.name, city.state, city.normalizedName]);
    await connection.query(
      `
        INSERT INTO location_cities (name, state, normalized_name)
        VALUES ?
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          normalized_name = VALUES(normalized_name),
          updated_at = CURRENT_TIMESTAMP
      `,
      [values]
    );
  }

  return catalog.length;
}
