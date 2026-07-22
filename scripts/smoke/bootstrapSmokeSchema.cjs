const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('node:path');

dotenv.config({ path: '.env' });

const sourceDatabase = process.env.DB_DATABASE || process.env.DATABASE_NAME;
const smokeDatabase = process.env.SMOKE_DATABASE || 'imobiliaria_smoke_v2';
const allowedSmokeDatabases = new Set(['imobiliaria_smoke_v2', 'imobiliaria_contract_e2e']);

if (!sourceDatabase || sourceDatabase === smokeDatabase || !allowedSmokeDatabases.has(smokeDatabase)) {
  throw new Error('O schema de origem do smoke deve ser o banco local de desenvolvimento.');
}

function connectionOptions(database) {
  const sslDisabled = (process.env.DB_SSL || process.env.DATABASE_SSL) === 'false';
  return {
    host: process.env.DB_HOST || process.env.DATABASE_HOST,
    port: Number(process.env.DB_PORT || process.env.DATABASE_PORT || 4000),
    user: process.env.DB_USER || process.env.DATABASE_USER,
    password: process.env.DB_PASSWORD || process.env.DATABASE_PASSWORD,
    database,
    ssl: sslDisabled ? undefined : { rejectUnauthorized: true },
  };
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.query(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1
    `,
    [tableName],
  );
  return rows.length > 0;
}

async function main() {
  const source = await mysql.createConnection(connectionOptions(sourceDatabase));
  // The target is an allowlisted, disposable schema. Never create or alter the source schema.
  const targetServer = await mysql.createConnection(connectionOptions(undefined));
  await targetServer.query(`CREATE DATABASE IF NOT EXISTS \`${smokeDatabase}\``);
  await targetServer.end();
  const target = await mysql.createConnection(connectionOptions(smokeDatabase));

  try {
    const [tables] = await source.query('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'');
    const sourceTableNames = tables
      .map((row) => String(Object.values(row)[0] ?? ''))
      .filter((tableName) => tableName && tableName !== 'schema_migrations');
    const pending = new Set(sourceTableNames);

    while (pending.size > 0) {
      let createdInPass = 0;
      for (const tableName of Array.from(pending)) {
        if (await tableExists(target, tableName)) {
          pending.delete(tableName);
          continue;
        }
      const [rows] = await source.query(`SHOW CREATE TABLE \`${tableName}\``);
      const ddl = rows[0]?.['Create Table'];
      if (!ddl) {
        throw new Error(`A tabela de origem ${tableName} não existe.`);
      }

        try {
          await target.query(ddl);
          pending.delete(tableName);
          createdInPass += 1;
          console.log(`Tabela vazia criada: ${tableName}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('referenced table')) {
            throw error;
          }
        }
      }

      if (createdInPass === 0) {
        throw new Error(`Não foi possível ordenar as dependências de: ${Array.from(pending).join(', ')}`);
      }
    }

    await target.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const migrationDirectory = path.resolve(__dirname, '..', 'migrations');
    const migrationNames = require('node:fs')
      .readdirSync(migrationDirectory)
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
    for (const migrationName of migrationNames) {
      await target.query('INSERT IGNORE INTO schema_migrations (name) VALUES (?)', [migrationName]);
    }
    console.log(`Migrations históricas marcadas como aplicadas: ${migrationNames.length}`);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
