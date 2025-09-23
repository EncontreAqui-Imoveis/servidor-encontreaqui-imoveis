import mysql from 'mysql2';
import dotenv from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const connection = mysql.createPool({
  host: 127.0.0.1,
  user: process.env.DATABASE_USER, // Lê o User do Railway
  password: process.env.DATABASE_PASSWORD, // Lê a Password do Railway
  database: process.env.DATABASE_NAME, // Lê o nome da Database do Railway
  port: 4000, 
  ssl: {
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

export default connection;
