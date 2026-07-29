import connection from './connection';
import { bootstrapDatabaseSchema } from './bootstrap';
import { runSqlMigrations } from './migrationRunner';
import { verifyCriticalSchemaState } from './schemaVerification';

async function main(): Promise<void> {
  await bootstrapDatabaseSchema();
  await runSqlMigrations('up');
  const summary = await verifyCriticalSchemaState();
  console.log(
    `Deploy de banco concluido. Tabelas: ${summary.checkedTables}, colunas: ${summary.checkedColumns}, enums: ${summary.checkedEnums}.`,
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Falha no deploy de banco:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await connection.end();
    });
}
