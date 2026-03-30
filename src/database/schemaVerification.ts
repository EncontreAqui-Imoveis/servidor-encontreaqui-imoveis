import { RowDataPacket } from 'mysql2';
import connection from './connection';

type SchemaVerificationSummary = {
  checkedTables: number;
  checkedColumns: number;
  checkedEnums: number;
};

async function tableExists(tableName: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1
    `,
    [tableName]
  );

  return rows.length > 0;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return rows.length > 0;
}

async function getColumnType(tableName: string, columnName: string): Promise<string | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT column_type
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );

  return typeof rows[0]?.column_type === 'string' ? rows[0].column_type : null;
}

function ensure(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertTable(tableName: string): Promise<void> {
  ensure(await tableExists(tableName), `Tabela obrigatoria ausente: ${tableName}`);
}

async function assertColumn(tableName: string, columnName: string): Promise<void> {
  ensure(
    await columnExists(tableName, columnName),
    `Coluna obrigatoria ausente: ${tableName}.${columnName}`
  );
}

async function assertEnumContains(
  tableName: string,
  columnName: string,
  requiredValues: string[]
): Promise<void> {
  const rawType = await getColumnType(tableName, columnName);
  ensure(rawType, `Nao foi possivel ler o tipo da coluna: ${tableName}.${columnName}`);

  const normalizedType = rawType!.toLowerCase();
  for (const value of requiredValues) {
    ensure(
      normalizedType.includes(`'${value.toLowerCase()}'`),
      `Enum incompleto em ${tableName}.${columnName}: valor '${value}' ausente`
    );
  }
}

export async function verifyCriticalSchemaState(): Promise<SchemaVerificationSummary> {
  const requiredTables = [
    'schema_migrations',
    'contracts',
    'negotiation_documents',
    'admins',
    'users',
    'property_edit_requests',
  ] as const;

  for (const tableName of requiredTables) {
    await assertTable(tableName);
  }

  const requiredColumns = [
    ['contracts', 'workflow_metadata'],
    ['contracts', 'seller_approval_status'],
    ['contracts', 'buyer_approval_status'],
    ['contracts', 'seller_approval_reason'],
    ['contracts', 'buyer_approval_reason'],
    ['negotiation_documents', 'document_type'],
    ['negotiation_documents', 'metadata_json'],
    ['negotiation_documents', 'storage_provider'],
    ['negotiation_documents', 'storage_bucket'],
    ['negotiation_documents', 'storage_key'],
    ['negotiation_documents', 'storage_content_type'],
    ['negotiation_documents', 'storage_size_bytes'],
    ['admins', 'token_version'],
    ['users', 'token_version'],
    ['properties', 'updated_at'],
    ['property_edit_requests', 'updated_at'],
    ['property_edit_requests', 'before_json'],
    ['property_edit_requests', 'after_json'],
    ['property_edit_requests', 'diff_json'],
    ['property_edit_requests', 'field_reviews_json'],
  ] as const;

  for (const [tableName, columnName] of requiredColumns) {
    await assertColumn(tableName, columnName);
  }

  await assertEnumContains('contracts', 'seller_approval_status', [
    'PENDING',
    'APPROVED',
    'APPROVED_WITH_RES',
    'REJECTED',
  ]);

  await assertEnumContains('contracts', 'buyer_approval_status', [
    'PENDING',
    'APPROVED',
    'APPROVED_WITH_RES',
    'REJECTED',
  ]);

  await assertEnumContains('negotiation_documents', 'document_type', [
    'doc_identidade',
    'comprovante_endereco',
    'certidao_casamento_nascimento',
    'certidao_inteiro_teor',
    'certidao_onus_acoes',
    'comprovante_renda',
    'contrato_minuta',
    'contrato_assinado',
    'comprovante_pagamento',
    'boleto_vistoria',
  ]);

  await assertEnumContains('property_edit_requests', 'status', [
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PARTIALLY_APPROVED',
  ]);

  return {
    checkedTables: requiredTables.length,
    checkedColumns: requiredColumns.length,
    checkedEnums: 4,
  };
}

async function main(): Promise<void> {
  const summary = await verifyCriticalSchemaState();
  console.log(
    `Schema critico verificado com sucesso. Tabelas: ${summary.checkedTables}, colunas: ${summary.checkedColumns}, enums: ${summary.checkedEnums}.`
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('Falha na verificacao de schema:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await connection.end();
    });
}
