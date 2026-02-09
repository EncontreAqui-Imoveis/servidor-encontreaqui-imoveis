import connection from '../src/database/connection';

async function main() {
    const tables = [
        'audit_logs',
        'commission_splits',
        'negotiation_close_submissions',
        'negotiation_signatures',
        'negotiation_contracts',
        'negotiation_documents',
        'negotiations'
    ];

    try {
        const db = await connection.getConnection();

        // Disable FK checks to allow dropping tables in any order
        await db.query('SET FOREIGN_KEY_CHECKS = 0');

        for (const table of tables) {
            console.log(`Dropping table ${table}...`);
            await db.query(`DROP TABLE IF EXISTS ${table}`);
        }

        // Drop index from properties if exists? No, columns.
        console.log('Dropping columns from properties...');
        try {
            await db.query(`ALTER TABLE properties DROP COLUMN visibility`);
        } catch (e) { }
        try {
            await db.query(`ALTER TABLE properties DROP COLUMN lifecycle_status`);
        } catch (e) { }

        console.log('Cleaning schema_migrations...');
        // We only want to remove entries for OUR migrations, to be safe.
        // Or just truncate if we are sure no other migrations exist. 
        // Given the list in scripts/migrations only has our files (plus maybe the dupes I deleted from fs but not db), 
        // it's safer to delete by name pattern or just truncate if this is the only migration system.
        // The previous check showed only these files in the dir.
        // I'll delete where name like '202602%'
        await db.query(`DELETE FROM schema_migrations WHERE name LIKE '202602%'`);

        await db.query('SET FOREIGN_KEY_CHECKS = 1');

        console.log('Cleanup complete.');
        db.release();

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

main();
