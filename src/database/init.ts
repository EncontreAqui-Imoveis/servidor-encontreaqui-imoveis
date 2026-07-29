import connection from './connection';
import { bootstrapDatabaseSchema } from './bootstrap';

async function main(): Promise<void> {
  const result = await bootstrapDatabaseSchema();
  console.log(
    `Bootstrap concluido em ${result.database}. Tabelas criadas: ${result.createdTables}. Migrations de baseline registradas: ${result.markedMigrations}.`,
  );
}

void main()
  .catch((error) => {
    console.error('Falha ao inicializar o banco:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end();
  });
