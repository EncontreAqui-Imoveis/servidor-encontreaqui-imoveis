import connection from '../src/database/connection';
import fs from 'fs';

async function main() {
    try {
        const [cols] = await connection.query('DESCRIBE properties');
        fs.writeFileSync('properties_schema.json', JSON.stringify(cols, null, 2));
        console.log('Schema written to properties_schema.json');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit(0);
    }
}

main();
