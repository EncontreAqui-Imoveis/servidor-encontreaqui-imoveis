import connection from '../src/database/connection';

async function main() {
    try {
        const [migrations] = await connection.query('SELECT * FROM schema_migrations');
        console.log('Applied Migrations:', JSON.stringify(migrations, null, 2));

        try {
            const [cols] = await connection.query('DESCRIBE negotiations');
            console.log('Negotiations Table Structure:', JSON.stringify(cols, null, 2));
        } catch (e) {
            console.log('Negotiations table does not exist or error describing it.');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

main();
