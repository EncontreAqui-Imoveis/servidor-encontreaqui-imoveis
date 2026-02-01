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
const sslEnabled = (env.DATABASE_SSL ?? env.DB_SSL ?? 'true') !== 'false';
const connectionOptions = {
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
const connection = mysql2_1.default.createPool(connectionOptions).promise();
exports.default = connection;
