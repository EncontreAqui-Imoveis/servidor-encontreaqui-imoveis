import connection from '../src/database/connection';

async function main() {
  try {
    const [rows] = await connection.query<any[]>(
      `SELECT * FROM negotiation_proposal_idempotency WHERE negotiation_id = '50c83374-04a2-4eb6-9385-707a38813a51'`
    );
    console.log('Idempotency rows:', rows);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await connection.end();
  }
}

main();
