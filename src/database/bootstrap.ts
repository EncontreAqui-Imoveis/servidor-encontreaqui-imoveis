import fs from 'fs';
import path from 'path';
import { RowDataPacket } from 'mysql2';
import connection from './connection';
import { applyMigrations } from './migrations';
import {
  ensureMigrationsTable,
  getAppliedMigrations,
  getMigrationNamesThrough,
  markMigrationsAppliedThrough,
} from './migrationRunner';
import { verifyCriticalSchemaState } from './schemaVerification';

const BASELINE_FILE = '20260729_001_current_schema.sql';
const BASELINE_MIGRATION_CUTOFF = '20260724_001_contract_document_rejection_history.sql';
const RESERVED_DATABASES = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

type BootstrapResult = {
  database: string;
  createdTables: number;
  markedMigrations: number;
};

function resolveBaselinePath(): string {
  return path.resolve(__dirname, '../../scripts/schema', BASELINE_FILE);
}

function extractCreateTableStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter((statement) => /^CREATE TABLE\s+/i.test(statement))
    .map((statement) => statement.replace(/^CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS '));
}

async function getCurrentDatabase(): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS database_name');
  const database = String(rows[0]?.database_name ?? '').trim();
  if (!database || RESERVED_DATABASES.has(database.toLowerCase())) {
    throw new Error(
      `Bootstrap recusado para o schema '${database || '(ausente)'}'. Configure DATABASE_NAME para um banco da aplicacao.`,
    );
  }
  return database;
}

async function countKnownTables(): Promise<number> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) AS total
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
    `,
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Creates the current application schema without business data. The baseline
 * comes from the locally verified TiDB schema and is safe to run repeatedly.
 */
export async function bootstrapDatabaseSchema(): Promise<BootstrapResult> {
  const database = await getCurrentDatabase();
  const baselinePath = resolveBaselinePath();
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`Arquivo de baseline ausente: ${baselinePath}`);
  }

  const statements = extractCreateTableStatements(fs.readFileSync(baselinePath, 'utf8'));
  if (statements.length === 0) {
    throw new Error(`Baseline sem CREATE TABLE: ${baselinePath}`);
  }

  const tablesBefore = await countKnownTables();
  for (const statement of statements) {
    await connection.query(statement);
  }
  await ensureMigrationsTable();

  // Repairs legacy partial bootstraps before the migration ledger is marked.
  await applyMigrations();
  await verifyCriticalSchemaState();

  const applied = await getAppliedMigrations();
  const expectedBaselineNames = getMigrationNamesThrough(BASELINE_MIGRATION_CUTOFF);
  const appliedNames = new Set(applied.map((migration) => migration.name));
  const missingBaselineNames = expectedBaselineNames.filter((name) => !appliedNames.has(name));

  // An empty ledger is expected for a newly created or legacy partial schema.
  // Any non-empty incomplete ledger is ambiguous and must be repaired manually.
  if (applied.length > 0 && missingBaselineNames.length > 0) {
    throw new Error(
      `Schema_migrations parcial detectada; faltam ${missingBaselineNames.length} migrations do baseline. ` +
      'O bootstrap foi interrompido sem alterar o ledger.',
    );
  }

  const markedMigrations = applied.length === 0
    ? await markMigrationsAppliedThrough(BASELINE_MIGRATION_CUTOFF)
    : 0;

  return {
    database,
    createdTables: Math.max(0, (await countKnownTables()) - tablesBefore),
    markedMigrations,
  };
}

async function main(): Promise<void> {
  const result = await bootstrapDatabaseSchema();
  console.log(
    `Bootstrap concluido em ${result.database}. Tabelas criadas: ${result.createdTables}. Migrations de baseline registradas: ${result.markedMigrations}.`,
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Falha no bootstrap do banco:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await connection.end();
    });
}
