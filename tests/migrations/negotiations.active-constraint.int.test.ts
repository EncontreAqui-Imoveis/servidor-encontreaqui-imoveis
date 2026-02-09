import connection from '../../src/database/connection';
// Ideally we should import Service, but for migration test we test SQL behavior or just schema existence.
// "Active constraint" is logic-based (transactional check in code) or unique index?
// Migration 009 created "CREATE INDEX idx_negotiations_property_active".
// This is NOT a UNIQUE index. It helps performance but does not enforce uniqueness.
// Uniqueness is enforced by Service logic (SELECT FOR UPDATE).
// So this test checks if index exists.

describe('Negotiations Active Constraint Index', () => {
    afterAll(async () => {
        await connection.end();
    });

    it('should have index on property_id and active', async () => {
        const [indexes] = await connection.query('SHOW INDEX FROM negotiations');
        const idx = (indexes as any[])
            .filter((i) => i.Key_name === 'idx_negotiations_property_active');

        expect(idx.length).toBeGreaterThan(0);
        const columns = idx.map(i => i.Column_name);
        expect(columns).toContain('property_id');
        expect(columns).toContain('active');
    });
});
