"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeDb = exports.cleanDb = void 0;
const connection_1 = __importDefault(require("../../src/database/connection"));
const cleanDb = async () => {
    const db = await connection_1.default.getConnection();
    try {
        await db.query('SET FOREIGN_KEY_CHECKS = 0');
        // Truncate tables in reverse order of dependency
        const tables = [
            'audit_logs',
            'commission_splits',
            'negotiation_close_submissions',
            'negotiation_signatures',
            'negotiation_contracts',
            'negotiation_documents',
            'negotiations',
            'properties',
            'users'
        ];
        for (const table of tables) {
            // Check if table exists before truncating to avoid errors in partial setups
            const [exists] = await db.query(`SHOW TABLES LIKE '${table}'`);
            if (exists.length > 0) {
                await db.query(`TRUNCATE TABLE ${table}`);
            }
        }
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    finally {
        db.release();
    }
};
exports.cleanDb = cleanDb;
const closeDb = async () => {
    await connection_1.default.end();
};
exports.closeDb = closeDb;
