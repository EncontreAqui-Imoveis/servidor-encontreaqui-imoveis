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
const connectionOptions = {
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
const connection = mysql2_1.default.createPool(connectionOptions).promise();
exports.default = connection;
