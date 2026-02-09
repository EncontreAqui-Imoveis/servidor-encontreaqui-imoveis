import connection from '../../src/database/connection';

describe('Negotiations Migrations', () => {
    afterAll(async () => {
        await connection.end();
    });

    it('should have created negotiations table with correct columns', async () => {
        const [cols] = await connection.query('DESCRIBE negotiations');
        const columns = (cols as any[]).map((c) => c.Field);
        expect(columns).toContain('id');
        expect(columns).toContain('property_id');
        expect(columns).toContain('status');
        expect(columns).toContain('active');
        expect(columns).toContain('created_at');
    });

    it('should have created negotiation_documents table', async () => {
        const [cols] = await connection.query('DESCRIBE negotiation_documents');
        const columns = (cols as any[]).map((c) => c.Field);
        expect(columns).toContain('doc_name');
        expect(columns).toContain('status');
    });

    it('should have added visibility to properties', async () => {
        const [cols] = await connection.query('DESCRIBE properties');
        const columns = (cols as any[]).map((c) => c.Field);
        expect(columns).toContain('visibility');
        expect(columns).toContain('lifecycle_status');
    });
});
