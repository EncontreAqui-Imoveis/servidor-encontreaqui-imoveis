import { ResultSetHeader, RowDataPacket } from 'mysql2';

import connection from '../database/connection';

export async function runUserQuery<T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
  sql: string,
  params?: unknown[]
): Promise<T> {
  const [rows] = await connection.query<T>(sql, params as unknown[]);
  return rows;
}
