import { RowDataPacket } from 'mysql2';
import { randomInt, randomUUID } from 'node:crypto';

import connection from '../database/connection';

export const PUBLIC_PROPERTY_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const PUBLIC_PROPERTY_CODE_LENGTH = 6;
export const PUBLIC_PROPERTY_CODE_REGEX = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

function generateRandomPublicPropertyCode(): string {
  let code = '';
  for (let i = 0; i < PUBLIC_PROPERTY_CODE_LENGTH; i += 1) {
    const index = randomInt(0, PUBLIC_PROPERTY_CODE_ALPHABET.length);
    code += PUBLIC_PROPERTY_CODE_ALPHABET[index];
  }
  return code;
}

function normalizeRawPublicCode(value: unknown): string | null {
  const trimmed = String(value ?? '').trim().toUpperCase();
  return PUBLIC_PROPERTY_CODE_REGEX.test(trimmed) ? trimmed : null;
}

export async function allocateNextPublicPropertyCode(): Promise<string> {
  const maxAttempts = 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = generateRandomPublicPropertyCode();
    const [existingRows] = await connection.query<RowDataPacket[]>(
      'SELECT 1 FROM properties WHERE public_code = ? LIMIT 1',
      [candidate]
    );

    if (existingRows.length === 0) {
      return candidate;
    }

    if (attempt >= maxAttempts) {
      throw new Error('Não foi possível gerar um código público único para o imóvel.');
    }
  }

  throw new Error('Não foi possível gerar um código público único para o imóvel.');
}

export type PublicPropertyIdentifiers = {
  publicId: string;
  publicCode: string;
};

export async function allocatePublicPropertyIdentifiers(): Promise<PublicPropertyIdentifiers> {
  return {
    publicId: randomUUID(),
    publicCode: await allocateNextPublicPropertyCode(),
  };
}

export async function ensurePublicPropertyIdentifiersForLegacyRows(
  batchSize = 100
): Promise<void> {
  let rows: RowDataPacket[];
  try {
    [rows] = await connection.query<RowDataPacket[]>(
      'SELECT id, public_id, public_code FROM properties WHERE public_id IS NULL OR public_code IS NULL LIMIT ?',
      [batchSize]
    );
  } catch {
    return;
  }

  for (const row of rows) {
    const id = Number(row.id);
    if (!Number.isFinite(id)) {
      continue;
    }

    const existingPublicId = typeof row.public_id === 'string' && row.public_id.trim().length > 0
      ? row.public_id
      : randomUUID();
    const existingPublicCode = normalizeRawPublicCode(row.public_code);

    const publicCode = existingPublicCode ?? await allocateNextPublicPropertyCode();

    await connection.query('UPDATE properties SET public_id = ?, public_code = ? WHERE id = ?', [
      existingPublicId,
      publicCode,
      id,
    ]);
  }
}

/**
 * Próximo código exibido do imóvel no formato 000001, 000002, ...
 * Baseado apenas em códigos numéricos já gravados; se não houver imóveis
 * (ou nenhum código numérico), retorna 000001.
 */
export async function allocateNextPropertyCode(): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT COALESCE(MAX(CAST(code AS UNSIGNED)), 0) AS maxn
      FROM properties
      WHERE code IS NOT NULL AND code REGEXP '^[0-9]+$'
    `
  );
  const maxn = Number((rows[0] as { maxn?: unknown })?.maxn ?? 0);
  const next = (Number.isFinite(maxn) ? maxn : 0) + 1;
  return String(next).padStart(6, '0');
}
