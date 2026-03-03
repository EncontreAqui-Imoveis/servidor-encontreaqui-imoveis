import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import connection from '../database/connection';

export async function queryContractRows<T extends RowDataPacket>(
  sql: string,
  params: unknown[]
): Promise<T[]> {
  const [rows] = await connection.query<T[]>(sql, params as unknown[]);
  return rows;
}

export function getContractDbConnection(): Promise<PoolConnection> {
  return connection.getConnection();
}
