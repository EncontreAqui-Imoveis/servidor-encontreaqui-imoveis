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
});
