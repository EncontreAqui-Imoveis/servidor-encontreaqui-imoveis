import connection from '../src/database/connection';

async function main() {
  try {
    const [rows]: any = await connection.query(`
      SELECT p.id, p.title, p.purpose, p.price, p.price_sale, p.price_rent, fp.scope, fp.position
      FROM featured_properties fp
      JOIN properties p ON p.id = fp.property_id
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch (error) {
    console.error(error);
  } finally {
    await connection.end();
  }
}

main();
