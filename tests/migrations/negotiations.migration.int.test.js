"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = __importDefault(require("../../src/database/connection"));
describe('Negotiations Migrations', () => {
    afterAll(async () => {
        await connection_1.default.end();
    });
    it('should have created negotiations table with correct columns', async () => {
        const [cols] = await connection_1.default.query('DESCRIBE negotiations');
        const columns = cols.map((c) => c.Field);
        expect(columns).toContain('id');
        expect(columns).toContain('property_id');
        expect(columns).toContain('status');
        expect(columns).toContain('active');
        expect(columns).toContain('created_at');
    });
    it('should have created negotiation_documents table', async () => {
        const [cols] = await connection_1.default.query('DESCRIBE negotiation_documents');
        const columns = cols.map((c) => c.Field);
        expect(columns).toContain('doc_name');
        expect(columns).toContain('status');
    });
    it('should have added visibility to properties', async () => {
        const [cols] = await connection_1.default.query('DESCRIBE properties');
        const columns = cols.map((c) => c.Field);
        expect(columns).toContain('visibility');
        expect(columns).toContain('lifecycle_status');
    });
});
