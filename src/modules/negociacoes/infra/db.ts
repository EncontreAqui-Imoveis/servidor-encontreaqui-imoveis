import { Pool, PoolConnection } from 'mysql2/promise';
import connection from '../../../database/connection';

export type QueryRunner = Pick<PoolConnection, 'query'> | Pick<Pool, 'query'>;

export function getDefaultQueryRunner(): QueryRunner {
  return connection;
}
