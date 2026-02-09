import connection from '../../src/database/connection';

export const cleanDb = async () => {
    const db = await connection.getConnection();
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
            if ((exists as any[]).length > 0) {
                await db.query(`TRUNCATE TABLE ${table}`);
            }
        }
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
        db.release();
    }
};

export const closeDb = async () => {
    await connection.end();
};
