"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = __importDefault(require("../../src/database/connection"));
// Ideally we should import Service, but for migration test we test SQL behavior or just schema existence.
// "Active constraint" is logic-based (transactional check in code) or unique index?
// Migration 009 created "CREATE INDEX idx_negotiations_property_active".
// This is NOT a UNIQUE index. It helps performance but does not enforce uniqueness.
// Uniqueness is enforced by Service logic (SELECT FOR UPDATE).
// So this test checks if index exists.
describe('Negotiations Active Constraint Index', () => {
    afterAll(async () => {
        await connection_1.default.end();
    });
    it('should have index on property_id and active', async () => {
        const [indexes] = await connection_1.default.query('SHOW INDEX FROM negotiations');
        const idx = indexes
            .filter((i) => i.Key_name === 'idx_negotiations_property_active');
        expect(idx.length).toBeGreaterThan(0);
        const columns = idx.map(i => i.Column_name);
        expect(columns).toContain('property_id');
        expect(columns).toContain('active');
    });
});
