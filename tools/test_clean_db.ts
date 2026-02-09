import { cleanDb, closeDb } from '../tests/helpers/testDb';

async function main() {
    try {
        console.log('Starting cleanDb...');
        await cleanDb();
        console.log('cleanDb finished successfully.');
    } catch (error) {
        console.error('cleanDb Failed:', error);
    } finally {
        await closeDb();
    }
}

main();
