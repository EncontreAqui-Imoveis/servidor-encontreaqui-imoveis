import connection from './src/database/connection';

async function run() {
    try {
        console.log("Deleting oldest 2 commits...");
        await connection.query('DELETE FROM sre_releases ORDER BY applied_at ASC LIMIT 2');
        console.log("Done");
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

run();
