import connection from '../src/database/connection';

async function main() {
    try {
        const conn = await connection.getConnection();
        try {
            await conn.query('SET FOREIGN_KEY_CHECKS = 0');
            console.log('Inserting users...');
            await conn.query(`INSERT IGNORE INTO users (id, name, email) VALUES 
            (1, "Captador", "c@test.com"),
            (2, "Seller", "s@test.com"),
            (3, "Admin", "a@test.com")`);
            console.log('Users inserted.');

            console.log('Inserting property...');
            await conn.query(`INSERT IGNORE INTO properties (id, title, owner_id, status, visibility, lifecycle_status, sem_numero) VALUES 
            (101, "Test Prop", 1, "approved", "PUBLIC", "AVAILABLE", 0)`);
            console.log('Property inserted.');

            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        } catch (e) {
            console.error('Insert Failed:', e);
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('Connection Error:', error);
    } finally {
        process.exit(0);
    }
}

main();
