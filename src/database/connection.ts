import mysql from 'mysql2';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const env = process.env;
const sslEnabled = (env.DATABASE_SSL ?? env.DB_SSL ?? 'true') !== 'false';

const connectionOptions: mysql.PoolOptions = {
  host: env.DATABASE_HOST ?? env.DB_HOST,
  user: env.DATABASE_USER ?? env.DB_USER,
  password: env.DATABASE_PASSWORD ?? env.DB_PASSWORD,
  database: env.DATABASE_NAME ?? env.DB_DATABASE,
  port: Number(env.DATABASE_PORT ?? env.DB_PORT ?? 4000),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: sslEnabled ? { rejectUnauthorized: true } : undefined,
};

const connection = mysql.createPool(connectionOptions).promise();

export default connection;

