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
  const result = await (connection.query as unknown as (
    querySql: string,
    queryParams: unknown[]
  ) => Promise<unknown>)(sql, params as unknown[]);

  if (Array.isArray(result)) {
    return result[0] as T;
  }

  return result as T;
}

export function getPropertyDbConnection(): Promise<PoolConnection> {
  return connection.getConnection();
}
