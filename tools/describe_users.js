"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = __importDefault(require("../src/database/connection"));
const fs_1 = __importDefault(require("fs"));
async function main() {
    try {
        const [cols] = await connection_1.default.query('DESCRIBE properties');
        fs_1.default.writeFileSync('properties_schema.json', JSON.stringify(cols, null, 2));
        console.log('Schema written to properties_schema.json');
    }
    catch (error) {
        console.error('Error:', error);
    }
    finally {
        process.exit(0);
    }
}
main();
