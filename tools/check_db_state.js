"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = __importDefault(require("../src/database/connection"));
async function main() {
    try {
        const [migrations] = await connection_1.default.query('SELECT * FROM schema_migrations');
        console.log('Applied Migrations:', JSON.stringify(migrations, null, 2));
        try {
            const [cols] = await connection_1.default.query('DESCRIBE negotiations');
            console.log('Negotiations Table Structure:', JSON.stringify(cols, null, 2));
        }
        catch (e) {
            console.log('Negotiations table does not exist or error describing it.');
        }
    }
    catch (error) {
        console.error('Error:', error);
    }
    finally {
        process.exit(0);
    }
}
main();
