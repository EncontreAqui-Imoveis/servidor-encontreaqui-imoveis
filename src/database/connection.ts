import mysql from 'mysql2';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const host = process.env.DATABASE_HOST ?? process.env.DB_HOST ?? '127.0.0.1';
const user = process.env.DATABASE_USER ?? process.env.DB_USER ?? 'root';
const password = process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD ?? '';
const database = process.env.DATABASE_NAME ?? process.env.DB_DATABASE ?? 'db_imobiliaria';
const port = Number(process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 3306);

const useSsl = String(process.env.DATABASE_SSL ?? process.env.DB_SSL ?? '').toLowerCase() === 'true';
const rejectUnauthorized = String(
  process.env.DB_SSL_REJECT_UNAUTHORIZED ?? process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? 'false',
).toLowerCase() === 'true';

const connectionOptions: mysql.PoolOptions = {
  host,
  user,
  password,
  database,
  port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ...(useSsl ? { ssl: { rejectUnauthorized } } : {}),
};

const connection = mysql.createPool(connectionOptions).promise();

export default connection;
