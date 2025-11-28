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
const host = process.env.DB_HOST ||
    process.env.DATABASE_HOST ||
    'localhost';
const user = process.env.DB_USER ||
    process.env.DATABASE_USER ||
    'root';
const password = process.env.DB_PASSWORD ||
    process.env.DATABASE_PASSWORD ||
    '';
const database = process.env.DB_DATABASE ||
    process.env.DATABASE_NAME ||
    'db_imobiliaria';
const port = Number(process.env.DB_PORT ||
    process.env.DATABASE_PORT ||
    3306);
const useSsl = String(process.env.DB_SSL || process.env.DATABASE_SSL || '')
    .toLowerCase() === 'true';
const resolvedHost = host === 'db' && process.env.NODE_ENV !== 'production'
    ? '127.0.0.1'
    : host;
const connectionOptions = {
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
const connection = mysql2_1.default.createPool(connectionOptions).promise();
exports.default = connection;
