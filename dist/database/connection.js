"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mysql2_1 = __importDefault(require("mysql2"));
const dotenv_1 = __importDefault(require("dotenv"));
if (process.env.NODE_ENV !== 'production') {
    dotenv_1.default.config();
}
const host = process.env.DATABASE_HOST ?? process.env.DB_HOST ?? '127.0.0.1';
const user = process.env.DATABASE_USER ?? process.env.DB_USER ?? 'root';
const password = process.env.DATABASE_PASSWORD ?? process.env.DB_PASSWORD ?? '';
const database = process.env.DATABASE_NAME ?? process.env.DB_DATABASE ?? 'db_imobiliaria';
const port = Number(process.env.DATABASE_PORT ?? process.env.DB_PORT ?? 3306);
const useSsl = String(process.env.DATABASE_SSL ?? process.env.DB_SSL ?? '').toLowerCase() === 'true';
const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED ?? process.env.DATABASE_SSL_REJECT_UNAUTHORIZED ?? 'false').toLowerCase() === 'true';
const connectionOptions = {
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
const connection = mysql2_1.default.createPool(connectionOptions).promise();
exports.default = connection;
