import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import connection from '../database/connection';

export type PropertyQueryExecutor = {
  query<T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
    sql: string,
    values?: unknown[]
  ): Promise<[T, unknown]>;
};

export const propertyQueryExecutor: PropertyQueryExecutor = {
  query(sql, values) {
    return connection.query(sql, values as unknown[]) as Promise<[any, unknown]>;
  },
};

export async function runPropertyQuery<T extends RowDataPacket[] | ResultSetHeader = RowDataPacket[]>(
  sql: string,
  params: unknown[]
): Promise<T> {
  const [rows] = await connection.query<T>(sql, params as unknown[]);
  return rows;
}

export function getPropertyDbConnection(): Promise<PoolConnection> {
  return connection.getConnection();
}
