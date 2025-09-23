import mysql from 'mysql2/promise';
import 'dotenv/config';

const connection = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true, 
  connectionLimit: 10,       
  queueLimit: 0             
});

console.log('Conexão com o banco de dados estabelecida com sucesso.');

export default connection;