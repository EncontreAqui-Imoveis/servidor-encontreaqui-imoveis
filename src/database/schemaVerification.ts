import { RowDataPacket } from 'mysql2';
import connection from './connection';
import {
  CONTRACT_APPROVAL_STATUSES,
  CONTRACT_DOCUMENT_TYPES,
} from '../modules/contracts/domain/contract.types';

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
    'negotiations',
    'properties',
    'admins',
    'users',
    'brokers',
    'property_edit_requests',
    'negotiation_responsibles',
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
    ['negotiations', 'payment_details'],
    ['negotiations', 'client_name'],
    ['negotiations', 'client_cpf'],
    ['negotiations', 'created_at'],
    ['negotiations', 'updated_at'],
    ['negotiations', 'last_draft_edit_at'],
    ['admins', 'token_version'],
    ['users', 'token_version'],
    ['brokers', 'profile_type'],
    ['properties', 'updated_at'],
    ['properties', 'sem_cep'],
    ['property_edit_requests', 'updated_at'],
    ['property_edit_requests', 'before_json'],
    ['property_edit_requests', 'after_json'],
    ['property_edit_requests', 'diff_json'],
    ['property_edit_requests', 'field_reviews_json'],
    ['negotiation_responsibles', 'negotiation_id'],
    ['negotiation_responsibles', 'user_id'],
  ] as const;

  for (const [tableName, columnName] of requiredColumns) {
    await assertColumn(tableName, columnName);
  }

  await assertEnumContains(
    'contracts',
    'seller_approval_status',
    Array.from(CONTRACT_APPROVAL_STATUSES)
  );

  await assertEnumContains(
    'contracts',
    'buyer_approval_status',
    Array.from(CONTRACT_APPROVAL_STATUSES)
  );

  await assertEnumContains(
    'negotiation_documents',
    'document_type',
    Array.from(CONTRACT_DOCUMENT_TYPES)
  );

  await assertEnumContains('property_edit_requests', 'status', [
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PARTIALLY_APPROVED',
  ]);

  await assertEnumContains('brokers', 'profile_type', [
    'BROKER',
    'AUXILIARY_ADMINISTRATIVE',
  ]);

  return {
    checkedTables: requiredTables.length,
    checkedColumns: requiredColumns.length,
    checkedEnums: 5,
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
