import mysql from 'mysql2';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const host =
  process.env.DB_HOST ||
  process.env.DATABASE_HOST ||
  'localhost';

const user =
  process.env.DB_USER ||
  process.env.DATABASE_USER ||
  'root';

const password =
  process.env.DB_PASSWORD ||
  process.env.DATABASE_PASSWORD ||
  '';

const database =
  process.env.DB_DATABASE ||
  process.env.DATABASE_NAME ||
  'db_imobiliaria';

const useSsl =
  String(process.env.DB_SSL || process.env.DATABASE_SSL || '')
    .toLowerCase() === 'true';

const resolvedHost =
  host === 'db' && process.env.NODE_ENV !== 'production'
    ? '127.0.0.1'
    : host;

const port = Number(
  process.env.DB_PORT ||
  process.env.DATABASE_PORT ||
  (resolvedHost === '127.0.0.1' ? 3307 : 3306)
);

const connectionOptions: mysql.PoolOptions = {
  host: resolvedHost,
  user,
  password,
  database,
  port,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
};

const connection = mysql.createPool(connectionOptions).promise();

export default connection;
