import mysql from 'mysql2';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const connectionOptions: mysql.PoolOptions = {
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  port: 4000,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: {
    rejectUnauthorized: true,
  }
};

const connection = mysql.createPool(connectionOptions).promise();

export default connection;

