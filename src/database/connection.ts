import mysql from 'mysql2';
import dotenv from 'dotenv';

// Carrega as variáveis do ficheiro .env APENAS em ambiente de desenvolvimento
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const connection = mysql.createPool({
  host: process.env.DATABASE_HOST, // Lê o Host do Railway
  user: process.env.DATABASE_USER, // Lê o User do Railway
  password: process.env.DATABASE_PASSWORD, // Lê a Password do Railway
  database: process.env.DATABASE_NAME, // Lê o nome da Database do Railway
  port: 4000, // Porta padrão do TiDB Cloud
  ssl: {
    // Essencial para a conexão segura com o TiDB Cloud
    rejectUnauthorized: true,
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise();

export default connection;