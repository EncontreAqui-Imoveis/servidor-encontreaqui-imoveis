import fs from 'fs';
import path from 'path';
import { RowDataPacket } from 'mysql2';
import connection from './connection';

type MigrationDirection = 'up' | 'down';

type MigrationFile = {
  name: string;
  path: string;
  upSql: string;
  downSql: string;
};

type StatementContext = {
  migrationName: string;
  migrationPath: string;
  direction: MigrationDirection;
  statementIndex: number;
  statementCount: number;
  statement: string;
};

type NegotiationConstraintViolationRow = RowDataPacket & {
  id: number;
  property_id: number | null;
  selling_broker_id: number | null;
  buyer_client_id: number | null;
  status: string | null;
};

type AppliedMigrationRow = RowDataPacket & {
  id: number;
  name: string;
  applied_at: Date;
};

const MIGRATION_MARKER_UP = '-- +migrate Up';
const MIGRATION_MARKER_DOWN = '-- +migrate Down';
const MIGRATION_DEBUG_ENABLED = ['1', 'true', 'yes'].includes(String(process.env.MIGRATION_DEBUG || '').toLowerCase());
const NEGOTIATIONS_SELLING_BROKER_CONSTRAINT = 'chk_negotiations_selling_broker_required';

function resolveMigrationsDir(): string {
  const currentDir = __dirname;
  return path.resolve(currentDir, '../../scripts/migrations');
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/g)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function statementSummary(statement: string): string {
  return statement.replace(/\s+/g, ' ').slice(0, 240);
}

function isKnownNegotiationsConstraintStatement(statement: string): boolean {
  const normalized = statement.toLowerCase();
  return (
    normalized.includes('add constraint') &&
    normalized.includes(NEGOTIATIONS_SELLING_BROKER_CONSTRAINT.toLowerCase()) &&
    normalized.includes('check')
  );
}

async function auditNegotiationsSellingBrokerConstraint(): Promise<NegotiationConstraintViolationRow[]> {
  const [rows] = await connection.query<NegotiationConstraintViolationRow[]>(
    `
      SELECT id, property_id, selling_broker_id, buyer_client_id, status
      FROM negotiations
      WHERE selling_broker_id IS NULL
        AND buyer_client_id IS NULL
        AND COALESCE(UPPER(TRIM(status)), '') NOT IN ('REFUSED', 'CANCELLED')
      ORDER BY id ASC
      LIMIT 20
    `
  );

  return rows;
}

function formatMigrationError(error: unknown, context: StatementContext): Error {
  const baseMessage = error instanceof Error ? error.message : String(error);
  const formatted = [
    `Falha na migration ${context.migrationName} (${context.direction})`,
    `Arquivo: ${context.migrationPath}`,
    `Statement ${context.statementIndex + 1}/${context.statementCount}: ${statementSummary(context.statement)}`,
    `Erro original: ${baseMessage}`,
  ].join(' | ');
  const wrapped = new Error(formatted);
  (wrapped as Error & { cause?: unknown }).cause = error;
  return wrapped;
}

function parseMigrationContent(name: string, fullPath: string, content: string): MigrationFile {
  const upIndex = content.indexOf(MIGRATION_MARKER_UP);
  const downIndex = content.indexOf(MIGRATION_MARKER_DOWN);

  if (upIndex === -1 || downIndex === -1 || downIndex <= upIndex) {
    throw new Error(`Migration ${name} invalida. Use marcadores ${MIGRATION_MARKER_UP} e ${MIGRATION_MARKER_DOWN}.`);
  }

  const upSql = content.slice(upIndex + MIGRATION_MARKER_UP.length, downIndex).trim();
  const downSql = content.slice(downIndex + MIGRATION_MARKER_DOWN.length).trim();

  if (!upSql) {
    throw new Error(`Migration ${name} sem bloco UP.`);
  }

  return {
    name,
    path: fullPath,
    upSql,
    downSql,
  };
}

function loadMigrationFiles(): MigrationFile[] {
  const migrationsDir = resolveMigrationsDir();
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const fileNames = fs
    .readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  return fileNames.map((fileName) => {
    const fullPath = path.join(migrationsDir, fileName);
    const content = fs.readFileSync(fullPath, 'utf8');
    return parseMigrationContent(fileName, fullPath, content);
  });
}

async function ensureMigrationsTable(): Promise<void> {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function getAppliedMigrations(): Promise<AppliedMigrationRow[]> {
  const [rows] = await connection.query<AppliedMigrationRow[]>(
    'SELECT id, name, applied_at FROM schema_migrations ORDER BY id ASC'
  );
  return rows;
}

async function executeSqlBlock(sqlBlock: string, context?: Omit<StatementContext, 'statement' | 'statementIndex' | 'statementCount'>): Promise<void> {
  const statements = splitSqlStatements(sqlBlock);
  if (statements.length === 0) {
    return;
  }

  const db = await connection.getConnection();
  try {
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index];
      const statementContext: StatementContext | undefined = context
        ? {
            ...context,
            statement,
            statementIndex: index,
            statementCount: statements.length,
          }
        : undefined;

      if (MIGRATION_DEBUG_ENABLED) {
        const prefix = statementContext
          ? `[migration-debug] ${statementContext.migrationName} ${statementContext.direction} ${index + 1}/${statements.length}`
          : '[migration-debug] statement';
        console.log(`${prefix}: ${statementSummary(statement)}`);
      }

      if (statementContext && isKnownNegotiationsConstraintStatement(statement)) {
        const violations = await auditNegotiationsSellingBrokerConstraint();
        if (violations.length > 0) {
          const preview = JSON.stringify(violations.slice(0, 5), null, 2);
          throw new Error(
            [
              `Constraint preflight failed for ${NEGOTIATIONS_SELLING_BROKER_CONSTRAINT}`,
              `Violating rows: ${violations.length}`,
              `Sample: ${preview}`,
            ].join(' | ')
          );
        }
      }

      try {
        await db.query(statement);
      } catch (error) {
        if (statementContext) {
          throw formatMigrationError(error, statementContext);
        }
        throw error;
      }
    }
  } catch (error) {
    throw error;
  } finally {
    db.release();
  }
}

async function applyUpMigrations(): Promise<void> {
  await ensureMigrationsTable();

  const allMigrations = loadMigrationFiles();
  const applied = await getAppliedMigrations();
  const appliedNames = new Set(applied.map((migration) => migration.name));

  const pending = allMigrations.filter((migration) => !appliedNames.has(migration.name));
  if (pending.length === 0) {
    console.log('Nenhuma migration pendente.');
    return;
  }

  for (const migration of pending) {
    console.log(`Aplicando migration: ${migration.name}`);
    console.log('SQL:', migration.upSql.substring(0, 500) + '...');
    await executeSqlBlock(migration.upSql, {
      migrationName: migration.name,
      migrationPath: migration.path,
      direction: 'up',
    });
    await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [migration.name]);
  }

  console.log(`Migrations aplicadas: ${pending.length}`);
}

async function applyDownMigration(targetName?: string): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  if (applied.length === 0) {
    console.log('Nenhuma migration aplicada para rollback.');
    return;
  }

  const allMigrations = loadMigrationFiles();
  const migrationMap = new Map(allMigrations.map((migration) => [migration.name, migration]));

  const target = targetName
    ? applied.find((migration) => migration.name === targetName)
    : applied[applied.length - 1];

  if (!target) {
    throw new Error(`Migration ${targetName} nao encontrada em schema_migrations.`);
  }

  const migrationFile = migrationMap.get(target.name);
  if (!migrationFile) {
    throw new Error(`Arquivo SQL da migration ${target.name} nao encontrado.`);
  }

  console.log(`Fazendo rollback da migration: ${target.name}`);
  await executeSqlBlock(migrationFile.downSql, {
    migrationName: migrationFile.name,
    migrationPath: migrationFile.path,
    direction: 'down',
  });
  await connection.query('DELETE FROM schema_migrations WHERE name = ?', [target.name]);
  console.log('Rollback concluido.');
}

async function showStatus(): Promise<void> {
  await ensureMigrationsTable();
  const all = loadMigrationFiles();
  const applied = await getAppliedMigrations();
  const appliedSet = new Set(applied.map((migration) => migration.name));

  for (const migration of all) {
    const status = appliedSet.has(migration.name) ? 'APPLIED' : 'PENDING';
    console.log(`${status}\t${migration.name}`);
  }

  if (all.length === 0) {
    console.log('Nenhuma migration SQL encontrada em scripts/migrations.');
  }
}

export async function runSqlMigrations(command: MigrationDirection | 'status', targetName?: string): Promise<void> {
  if (command === 'up') {
    await applyUpMigrations();
    return;
  }

  if (command === 'down') {
    await applyDownMigration(targetName);
    return;
  }

  await showStatus();
}

async function main(): Promise<void> {
  const commandArg = (process.argv[2] || 'status').toLowerCase();
  const targetName = process.argv[3];

  if (commandArg !== 'up' && commandArg !== 'down' && commandArg !== 'status') {
    throw new Error('Comando invalido. Use: up | down | status');
  }

  await runSqlMigrations(commandArg, targetName);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Falha no migration runner:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await connection.end();
    });
}
