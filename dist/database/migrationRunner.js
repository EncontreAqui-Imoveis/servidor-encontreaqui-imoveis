"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSqlMigrations = runSqlMigrations;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const connection_1 = __importDefault(require("./connection"));
const MIGRATION_MARKER_UP = '-- +migrate Up';
const MIGRATION_MARKER_DOWN = '-- +migrate Down';
function resolveMigrationsDir() {
    const currentDir = __dirname;
    return path_1.default.resolve(currentDir, '../../scripts/migrations');
}
function splitSqlStatements(sql) {
    return sql
        .split(/;\s*(?:\r?\n|$)/g)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);
}
function parseMigrationContent(name, fullPath, content) {
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
function loadMigrationFiles() {
    const migrationsDir = resolveMigrationsDir();
    if (!fs_1.default.existsSync(migrationsDir)) {
        return [];
    }
    const fileNames = fs_1.default
        .readdirSync(migrationsDir)
        .filter((fileName) => fileName.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b));
    return fileNames.map((fileName) => {
        const fullPath = path_1.default.join(migrationsDir, fileName);
        const content = fs_1.default.readFileSync(fullPath, 'utf8');
        return parseMigrationContent(fileName, fullPath, content);
    });
}
async function ensureMigrationsTable() {
    await connection_1.default.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
async function getAppliedMigrations() {
    const [rows] = await connection_1.default.query('SELECT id, name, applied_at FROM schema_migrations ORDER BY id ASC');
    return rows;
}
async function executeSqlBlock(sqlBlock) {
    const statements = splitSqlStatements(sqlBlock);
    if (statements.length === 0) {
        return;
    }
    const db = await connection_1.default.getConnection();
    try {
        await db.beginTransaction();
        for (const statement of statements) {
            await db.query(statement);
        }
        await db.commit();
    }
    catch (error) {
        await db.rollback();
        throw error;
    }
    finally {
        db.release();
    }
}
async function applyUpMigrations() {
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
        await executeSqlBlock(migration.upSql);
        await connection_1.default.query('INSERT INTO schema_migrations (name) VALUES (?)', [migration.name]);
    }
    console.log(`Migrations aplicadas: ${pending.length}`);
}
async function applyDownMigration(targetName) {
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
    await executeSqlBlock(migrationFile.downSql);
    await connection_1.default.query('DELETE FROM schema_migrations WHERE name = ?', [target.name]);
    console.log('Rollback concluido.');
}
async function showStatus() {
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
async function runSqlMigrations(command, targetName) {
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
async function main() {
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
        await connection_1.default.end();
    });
}
