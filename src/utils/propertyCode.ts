import { RowDataPacket } from 'mysql2';

import connection from '../database/connection';

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
