import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
    end: vi.fn(),
  },
}));

describe('verifyCriticalSchemaState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when critical tables, columns and enum values are present', async () => {
    queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.includes('FROM information_schema.tables')) {
        return [[{ ok: 1 }]];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT 1')
      ) {
        return [[{ ok: 1 }]];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT column_type')
      ) {
        const [tableName, columnName] = params as [string, string];
        if (
          tableName === 'contracts' &&
          (columnName === 'seller_approval_status' || columnName === 'buyer_approval_status')
        ) {
          return [[{ column_type: "enum('PENDING','APPROVED','APPROVED_WITH_RES','REJECTED')" }]];
        }

        if (tableName === 'negotiation_documents' && columnName === 'document_type') {
          return [[{
            column_type:
              "enum('doc_identidade','comprovante_endereco','certidao_casamento_nascimento','certidao_inteiro_teor','certidao_onus_acoes','comprovante_renda','contrato_minuta','contrato_assinado','comprovante_pagamento','boleto_vistoria')",
          }]];
        }

        if (tableName === 'property_edit_requests' && columnName === 'status') {
          return [[{
            column_type:
              "enum('PENDING','APPROVED','REJECTED','PARTIALLY_APPROVED')",
          }]];
        }

        return [[{ column_type: 'varchar(255)' }]];
      }

      return [[]];
    });

    const { verifyCriticalSchemaState } = await import('../../src/database/schemaVerification');
    const result = await verifyCriticalSchemaState();

    expect(result).toEqual({
      checkedTables: 6,
      checkedColumns: 20,
      checkedEnums: 4,
    });
  });

  it('fails when a critical column is missing', async () => {
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
        if (tableName === 'users' && columnName === 'token_version') {
          return [[]];
        }
        return [[{ ok: 1 }]];
      }

      if (
        normalizedSql.includes('FROM information_schema.columns') &&
        normalizedSql.includes('SELECT column_type')
      ) {
        return [[{ column_type: "enum('PENDING','APPROVED','APPROVED_WITH_RES','REJECTED')" }]];
      }

      return [[]];
    });

    const { verifyCriticalSchemaState } = await import('../../src/database/schemaVerification');

    await expect(verifyCriticalSchemaState()).rejects.toThrow(
      'Coluna obrigatoria ausente: users.token_version'
    );
  });
});
