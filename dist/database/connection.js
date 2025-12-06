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
const env = process.env;
const bool = (value, fallback = false) => {
    if (value === undefined)
        return fallback;
    const normalized = value.toString().trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
};
const host = env.DATABASE_HOST ??
    env.DB_HOST ??
    env.MYSQLHOST ??
    env.MYSQL_HOST ??
    '127.0.0.1';
const user = env.DATABASE_USER ??
    env.DB_USER ??
    env.MYSQLUSER ??
    env.MYSQL_USER ??
    'root';
const password = env.DATABASE_PASSWORD ??
    env.DB_PASSWORD ??
    env.MYSQLPASSWORD ??
    env.MYSQL_PASSWORD ??
    '';
const database = env.DATABASE_NAME ??
    env.DB_DATABASE ??
    env.MYSQLDATABASE ??
    env.MYSQL_DATABASE ??
    'db_imobiliaria';
const port = Number(env.DATABASE_PORT ??
    env.DB_PORT ??
    env.MYSQLPORT ??
    env.MYSQL_PORT ??
    3306);
const isRemoteHost = !['localhost', '127.0.0.1', 'db'].includes(host);
const useSsl = bool(env.DATABASE_SSL) ||
    bool(env.DB_SSL) ||
    bool(env.MYSQL_SSL) ||
    (isRemoteHost && bool(env.DATABASE_SSL ?? env.DB_SSL ?? env.MYSQL_SSL, true));
const rejectUnauthorized = bool(env.DB_SSL_REJECT_UNAUTHORIZED ??
    env.DATABASE_SSL_REJECT_UNAUTHORIZED ??
    env.MYSQL_SSL_REJECT_UNAUTHORIZED, false);
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
    connectTimeout: 10_000,
    ...(useSsl ? { ssl: { rejectUnauthorized } } : {}),
};
const connection = mysql2_1.default.createPool(connectionOptions).promise();
exports.default = connection;
