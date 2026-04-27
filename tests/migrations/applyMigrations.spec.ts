import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

describe('applyMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds critical contract and token columns when they are missing', async () => {
    const missingColumns = new Set([
      'contracts.seller_approval_status',
      'contracts.buyer_approval_status',
      'contracts.seller_approval_reason',
      'contracts.buyer_approval_reason',
      'contracts.workflow_metadata',
      'negotiation_documents.document_type',
      'negotiation_documents.metadata_json',
      'admins.token_version',
      'users.token_version',
    ]);

    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.includes('FROM information_schema.tables')) {
        return [[{ ok: 1 }]];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT 1')
      ) {
        const [tableName, columnName] = params as [string, string];
        const key = `${tableName}.${columnName}`;
        return [missingColumns.has(key) ? [] : [{ ok: 1 }]];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT column_type')
      ) {
        const [tableName, columnName] = params as [string, string];
        if (tableName === 'properties' && columnName === 'purpose') {
          return [[{ column_type: "enum('Venda','Aluguel','Venda e Aluguel')" }]];
        }

        return [[]];
      }

      return [[]];
    });

    const { applyMigrations } = await import('../../src/database/migrations');
    await applyMigrations();

    const sqlStatements = queryMock.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());

    expect(
      sqlStatements.some((sql) =>
        sql.includes('ALTER TABLE contracts ADD COLUMN seller_approval_status')
      )
    ).toBe(true);

    expect(
      sqlStatements.some((sql) =>
        sql.includes('ALTER TABLE contracts ADD COLUMN workflow_metadata JSON NULL')
      )
    ).toBe(true);

    expect(
      sqlStatements.some((sql) =>
        sql.includes('ALTER TABLE negotiation_documents ADD COLUMN document_type')
      )
    ).toBe(true);

    expect(
      sqlStatements.some((sql) =>
        sql.includes('ALTER TABLE admins ADD COLUMN token_version INT NOT NULL DEFAULT 1')
      )
    ).toBe(true);

    expect(
      sqlStatements.some((sql) =>
        sql.includes('ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 1')
      )
    ).toBe(true);

    expect(
      sqlStatements.some((sql) =>
        sql.includes('UPDATE admins SET token_version = 1 WHERE token_version IS NULL OR token_version < 1')
      )
    ).toBe(true);

    expect(
      sqlStatements.some((sql) =>
        sql.includes('UPDATE users SET token_version = 1 WHERE token_version IS NULL OR token_version < 1')
      )
    ).toBe(true);
  });

  it('realinha tipo do FK negotiation_responsibles.negotiation_id antes de recriar a FK', async () => {
    const requiredTables = new Set([
      'brokers',
      'negotiations',
      'users',
      'admins',
      'negotiation_responsibles',
    ]);
    const existingColumns = new Set([
      'brokers.profile_type',
      'negotiation_responsibles.negotiation_id',
      'negotiation_responsibles.user_id',
      'negotiation_responsibles.assigned_by',
      'users.id',
      'admins.id',
      'negotiations.id',
    ]);

    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      if (normalizedSql.includes('FROM information_schema.tables')) {
        const [tableName] = params as [string];
        return [requiredTables.has(String(tableName)) ? [{ ok: 1 }] : []];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT 1')
      ) {
        const [tableName, columnName] = params as [string, string];
        const key = `${tableName}.${columnName}`;
        return [existingColumns.has(key) ? [{ ok: 1 }] : []];
      }

      if (normalizedSql.includes('FROM information_schema.columns') && normalizedSql.includes('column_type,')) {
        const [tableName, columnName] = params as [string, string];
        const key = `${tableName}.${columnName}`;
        const metadataByColumn = {
          'negotiations.id': {
            column_type: 'char(36)',
            data_type: 'char',
            character_set_name: 'utf8mb4',
            collation_name: 'utf8mb4_0900_ai_ci',
          },
          'users.id': {
            column_type: 'int(10) unsigned',
            data_type: 'int',
            character_set_name: null,
            collation_name: null,
          },
          'admins.id': {
            column_type: 'int(10) unsigned',
            data_type: 'int',
            character_set_name: null,
            collation_name: null,
          },
          'negotiation_responsibles.negotiation_id': {
            column_type: 'int(10) unsigned',
            data_type: 'int',
            character_set_name: null,
            collation_name: null,
          },
          'negotiation_responsibles.user_id': {
            column_type: 'int(10) unsigned',
            data_type: 'int',
            character_set_name: null,
            collation_name: null,
          },
          'negotiation_responsibles.assigned_by': {
            column_type: 'int(10) unsigned',
            data_type: 'int',
            character_set_name: null,
            collation_name: null,
          },
        } as Record<string, Record<string, string | null>>;

        if (metadataByColumn[key]) {
          return [[metadataByColumn[key]]];
        }
        return [[{
          column_type: 'int(11)',
          data_type: 'int',
          character_set_name: null,
          collation_name: null,
        }]];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT column_type')
      ) {
        const [tableName, columnName] = params as [string, string];
        const key = `${tableName}.${columnName}`;
        if (key === 'negotiation_responsibles.negotiation_id') {
          return [[{ column_type: 'int(10) unsigned' }]];
        }
        if (key === 'users.id') {
          return [[{ column_type: 'int(10) unsigned' }]];
        }
        if (key === 'admins.id') {
          return [[{ column_type: 'int(10) unsigned' }]];
        }
        if (key === 'negotiations.id') {
          return [[{ column_type: 'char(36)' }]];
        }
        return [[{ column_type: 'int(11)' }]];
      }

      if (normalizedSql.toLowerCase().includes('from information_schema.referential_constraints')) {
        const [tableName, constraintName] = params as [string, string];
        if (
          tableName === 'negotiation_responsibles'
          && constraintName === 'fk_negotiation_responsibles_negotiation'
        ) {
          return [[{ CONSTRAINT_NAME: 'fk_negotiation_responsibles_negotiation' }]];
        }
        return [];
      }

      return [[]];
    });

    const { applyMigrations } = await import('../../src/database/migrations');
    await applyMigrations();

    const sqlStatements = queryMock.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, ' ').trim());

    expect(
      sqlStatements.some((sql) =>
        sql.includes('ALTER TABLE negotiation_responsibles DROP FOREIGN KEY fk_negotiation_responsibles_negotiation'),
      ),
    ).toBe(true);
    expect(
      sqlStatements.some((sql) =>
        sql.includes('MODIFY COLUMN negotiation_id char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL'),
      ),
    ).toBe(true);
    expect(
      sqlStatements.some((sql) =>
        sql.includes('ADD CONSTRAINT fk_negotiation_responsibles_negotiation'),
      ),
    ).toBe(true);
  });
});
