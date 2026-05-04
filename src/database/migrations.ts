import { RowDataPacket } from 'mysql2';
import connection from './connection';
import { PROPERTY_TYPE_LEGACY_UPDATES } from '../utils/propertyTypes';
import {
  CONTRACT_APPROVAL_STATUSES,
  CONTRACT_DOCUMENT_TYPES,
} from '../modules/contracts/domain/contract.types';

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

async function indexExists(tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
      LIMIT 1
    `,
    [tableName, indexName]
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

  return rows[0]?.column_type ?? null;
}

type ColumnMetadata = {
  tableName: string;
  columnName: string;
  columnType: string;
  dataType: string;
  characterSetName: string | null;
  collationName: string | null;
};

async function getColumnMetadata(
  tableName: string,
  columnName: string,
): Promise<ColumnMetadata | null> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT column_type, data_type, character_set_name, collation_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName],
  );
  const row = rows[0];
  if (!row?.column_type || !row?.data_type) {
    return null;
  }
  return {
    tableName,
    columnName,
    columnType: String(row.column_type),
    dataType: String(row.data_type),
    characterSetName: row.character_set_name == null ? null : String(row.character_set_name),
    collationName: row.collation_name == null ? null : String(row.collation_name),
  };
}

function shouldKeepCharacterSettings(refType: string): boolean {
  const dataType = refType.toLowerCase();
  return (
    dataType.includes('char')
    || dataType.includes('text')
    || dataType.includes('binary')
  );
}

function isFkColumnCompatible(
  referenced: ColumnMetadata | null,
  referencing: ColumnMetadata | null,
) {
  if (!referenced || !referencing) return false;
  if (shouldKeepCharacterSettings(referenced.dataType) || shouldKeepCharacterSettings(referencing.dataType)) {
    return (
      normalizeForeignKeyType(referenced.columnType) === normalizeForeignKeyType(referencing.columnType)
      && (referenced.characterSetName ?? '') === (referencing.characterSetName ?? '')
      && (referenced.collationName ?? '') === (referencing.collationName ?? '')
    );
  }
  return normalizeForeignKeyType(referenced.columnType) === normalizeForeignKeyType(referencing.columnType);
}

function formatFkColumnType(columnMeta: ColumnMetadata | null, fallbackType: string): string {
  if (!columnMeta) {
    return fallbackType;
  }
  let typeExpression = columnMeta.columnType;
  if (columnMeta.characterSetName) {
    typeExpression = `${typeExpression} CHARACTER SET ${columnMeta.characterSetName}`;
  }
  if (columnMeta.collationName) {
    typeExpression = `${typeExpression} COLLATE ${columnMeta.collationName}`;
  }
  return typeExpression;
}

function normalizeForeignKeyType(columnType: string): string {
  return columnType
    .toLowerCase()
    .replace(/\s+collate\s+[^\s]+/g, '')
    .replace(/\s+character set\s+[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isColumnTypeCompatibleForForeignKey(
  referencedType: string,
  referencingType: string,
): boolean {
  return normalizeForeignKeyType(referencedType) === normalizeForeignKeyType(referencingType);
}

async function hasForeignKeyConstraint(
  tableName: string,
  constraintName: string,
): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT 1
      FROM information_schema.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?
      LIMIT 1
    `,
    [tableName, constraintName],
  );
  return rows.length > 0;
}

const CONTRACT_DOCUMENT_TYPE_VALUES = CONTRACT_DOCUMENT_TYPES;

const CONTRACT_DOCUMENT_TYPE_ENUM_SQL = CONTRACT_DOCUMENT_TYPE_VALUES.map(
  (value) => `'${value}'`
).join(', ');

const CONTRACT_APPROVAL_STATUS_VALUES = CONTRACT_APPROVAL_STATUSES;

const CONTRACT_APPROVAL_STATUS_ENUM_SQL = CONTRACT_APPROVAL_STATUS_VALUES.map(
  (value) => `'${value}'`
).join(', ');

async function ensurePropertiesColumns(): Promise<void> {
  if (!(await columnExists('properties', 'owner_id'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN owner_id INT NULL');
  }

  if (!(await columnExists('properties', 'owner_name'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN owner_name VARCHAR(255) NULL');
  }

  if (!(await columnExists('properties', 'owner_phone'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN owner_phone VARCHAR(50) NULL');
  }
  if (!(await columnExists('properties', 'cep'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN cep VARCHAR(20) NULL');
  }

  if (!(await columnExists('properties', 'sem_cep'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN sem_cep TINYINT(1) NOT NULL DEFAULT 0 AFTER cep'
    );
  }

  if (await columnExists('properties', 'tipo_lote')) {
    await connection.query('ALTER TABLE properties DROP COLUMN tipo_lote');
  }

  if (!(await columnExists('properties', 'price_sale'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN price_sale DECIMAL(12, 2) NULL');
  }

  if (!(await columnExists('properties', 'price_rent'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN price_rent DECIMAL(12, 2) NULL');
  }

  if (!(await columnExists('properties', 'promotion_price'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promotion_price DECIMAL(12, 2) NULL'
    );
  }

  if (!(await columnExists('properties', 'promotional_rent_price'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promotional_rent_price DECIMAL(12, 2) NULL'
    );
  }

  if (!(await columnExists('properties', 'promotional_rent_percentage'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promotional_rent_percentage DECIMAL(5, 2) NULL'
    );
  }

  if (!(await columnExists('properties', 'is_promoted'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN is_promoted TINYINT(1) NOT NULL DEFAULT 0'
    );
  }

  if (!(await columnExists('properties', 'promotion_percentage'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promotion_percentage DECIMAL(5, 2) NULL'
    );
  }

  if (!(await columnExists('properties', 'promotion_start'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promotion_start DATETIME NULL'
    );
  }

  if (!(await columnExists('properties', 'promotion_end'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promotion_end DATETIME NULL'
    );
  }

  if (!(await columnExists('properties', 'promo_percentage'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promo_percentage DECIMAL(5, 2) NULL'
    );
  }

  if (!(await columnExists('properties', 'promo_start_date'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promo_start_date DATE NULL'
    );
  }

  if (!(await columnExists('properties', 'promo_end_date'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN promo_end_date DATE NULL'
    );
  }

  if (!(await columnExists('properties', 'updated_at'))) {
    await connection.query(
      'ALTER TABLE properties ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    );
  }

  if (!(await columnExists('properties', 'quadra'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN quadra VARCHAR(100) NULL');
  }

  if (!(await columnExists('properties', 'lote'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN lote VARCHAR(100) NULL');
  }

  const quadraType = await getColumnType('properties', 'quadra');
  if (quadraType && !quadraType.toLowerCase().includes('varchar')) {
    await connection.query('ALTER TABLE properties MODIFY COLUMN quadra VARCHAR(100) NULL');
  }

  const loteType = await getColumnType('properties', 'lote');
  if (loteType && !loteType.toLowerCase().includes('varchar')) {
    await connection.query('ALTER TABLE properties MODIFY COLUMN lote VARCHAR(100) NULL');
  }

  const purposeType = await getColumnType('properties', 'purpose');
  if (purposeType && !purposeType.includes('Venda e Aluguel')) {
    await connection.query(
      "ALTER TABLE properties MODIFY COLUMN purpose ENUM('Venda', 'Aluguel', 'Venda e Aluguel') NOT NULL"
    );
  }

  const propertyTypeType = await getColumnType('properties', 'type');
  if (propertyTypeType && !propertyTypeType.toLowerCase().includes('varchar')) {
    await connection.query(
      'ALTER TABLE properties MODIFY COLUMN type VARCHAR(100) NOT NULL'
    );
  }

  const priceColumns: Array<{ name: string; nullable: boolean }> = [
    { name: 'price', nullable: false },
    { name: 'price_sale', nullable: true },
    { name: 'price_rent', nullable: true },
    { name: 'promotion_price', nullable: true },
    { name: 'promotional_rent_price', nullable: true },
  ];

  for (const { name, nullable } of priceColumns) {
    const currentType = await getColumnType('properties', name);
    if (currentType && currentType.toLowerCase() !== 'decimal(12,2)') {
      await connection.query(
        `ALTER TABLE properties MODIFY COLUMN ${name} DECIMAL(12, 2) ${nullable ? 'NULL' : 'NOT NULL'}`
      );
    }
  }

  for (const { from, to } of PROPERTY_TYPE_LEGACY_UPDATES) {
    await connection.query(
      'UPDATE properties SET type = ? WHERE type = ?',
      [to, from]
    );
  }

  if (!(await columnExists('properties', 'visibility'))) {
    await connection.query(
      "ALTER TABLE properties ADD COLUMN visibility VARCHAR(32) NULL DEFAULT 'PUBLIC'"
    );
  }
  if (!(await columnExists('properties', 'lifecycle_status'))) {
    await connection.query(
      "ALTER TABLE properties ADD COLUMN lifecycle_status VARCHAR(32) NULL DEFAULT 'AVAILABLE'"
    );
  }
  if (!(await columnExists('properties', 'rejection_reason'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN rejection_reason TEXT NULL');
  }
  if (!(await columnExists('properties', 'amenities'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN amenities JSON NULL');
  }
}

async function ensurePropertyEditRequestsTable(): Promise<void> {
  if (!(await tableExists('property_edit_requests'))) {
    await connection.query(`
      CREATE TABLE property_edit_requests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        property_id INT NOT NULL,
        requester_user_id INT NOT NULL,
        requester_role ENUM('broker', 'client') NOT NULL,
        status ENUM('PENDING', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED') NOT NULL DEFAULT 'PENDING',
        before_json JSON NOT NULL,
        after_json JSON NOT NULL,
        diff_json JSON NOT NULL,
        field_reviews_json JSON NULL,
        review_reason TEXT NULL,
        reviewed_by INT NULL,
        reviewed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_property_edit_requests_property_status (property_id, status),
        INDEX idx_property_edit_requests_status_created (status, created_at),
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
        FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);
    return;
  }

  if (!(await columnExists('property_edit_requests', 'updated_at'))) {
    await connection.query(
      'ALTER TABLE property_edit_requests ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
    );
  }

  if (!(await columnExists('property_edit_requests', 'field_reviews_json'))) {
    await connection.query(
      'ALTER TABLE property_edit_requests ADD COLUMN field_reviews_json JSON NULL AFTER diff_json'
    );
  }

  const statusType = await getColumnType('property_edit_requests', 'status');
  if (statusType && !statusType.includes('PARTIALLY_APPROVED')) {
    await connection.query(
      "ALTER TABLE property_edit_requests MODIFY COLUMN status ENUM('PENDING', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED') NOT NULL DEFAULT 'PENDING'"
    );
  }
}

async function ensureFeaturedPropertiesTable(): Promise<void> {
  if (await tableExists('featured_properties')) {
    return;
  }

  await connection.query(`
    CREATE TABLE featured_properties (
      property_id INT NOT NULL,
      scope ENUM('sale', 'rent') NOT NULL DEFAULT 'sale',
      position INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id, scope),
      UNIQUE KEY idx_featured_scope_position (scope, position),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);
}

function isSafeMySqlIdentifier(name: string): boolean {
  return /^[A-Za-z0-9_]+$/.test(name);
}

/** Tabelas antigas: PK só em property_id; evolui para (property_id, scope) e posição única por escopo. */
async function migrateFeaturedPropertiesScopeImpl(): Promise<void> {
  if (!(await tableExists('featured_properties'))) {
    return;
  }
  if (await columnExists('featured_properties', 'scope')) {
    return;
  }

  // Remove índice único antigo em `position` (nome costuma ser idx_featured_position; varia em instalações).
  const [posUnique] = await connection.query<RowDataPacket[]>(
    `
      SELECT DISTINCT INDEX_NAME
      FROM information_schema.STATISTICS
      WHERE table_schema = DATABASE()
        AND table_name = 'featured_properties'
        AND column_name = 'position'
        AND non_unique = 0
        AND index_name != 'PRIMARY'
    `
  );
  for (const row of posUnique) {
    const iname = String((row as { INDEX_NAME: string }).INDEX_NAME);
    if (iname === 'idx_featured_scope_position' || !isSafeMySqlIdentifier(iname)) {
      continue;
    }
    try {
      await connection.query(
        'ALTER TABLE featured_properties DROP INDEX `' + iname.replace(/`/g, '') + '`'
      );
    } catch {
      // índice já removido ou outro conflito; segue
    }
  }
  // InnoDB exige um índice em property_id (FK) ao remover a PK: mesmo ALTER evita "missing index".
  await connection.query(
    'ALTER TABLE featured_properties DROP PRIMARY KEY, ADD KEY idx_featured_property_fk (property_id)'
  );
  await connection.query(`
    ALTER TABLE featured_properties
      ADD COLUMN scope ENUM('sale', 'rent') NOT NULL DEFAULT 'sale' AFTER property_id
  `);
  await connection.query(
    'ALTER TABLE featured_properties DROP INDEX idx_featured_property_fk, ADD PRIMARY KEY (property_id, scope)'
  );
  try {
    await connection.query(
      'ALTER TABLE featured_properties ADD UNIQUE KEY idx_featured_scope_position (scope, position)'
    );
  } catch {
    // idempotente se migração parcial
  }
}

/**
 * Idempotente: garante a coluna `scope` (e PK composta) em `featured_properties`.
 * Pode ser chamada no boot (`applyMigrations`) e antes dos endpoints de destaques
 * (auto-reparo se alguma instalação não aplicou a migração).
 */
export async function runFeaturedPropertiesScopeMigration(): Promise<void> {
  if (!(await tableExists('featured_properties'))) {
    return;
  }
  if (await columnExists('featured_properties', 'scope')) {
    return;
  }
  try {
    await migrateFeaturedPropertiesScopeImpl();
  } catch (e) {
    console.error(
      '[featured_properties] Migração scope (tabela legada) falhou, tentando reparo mínimo:',
      e
    );
    const scopeNow = await columnExists('featured_properties', 'scope');
    if (!scopeNow) {
      try {
        await connection.query(`
          ALTER TABLE featured_properties
            ADD COLUMN scope ENUM('sale', 'rent') NOT NULL DEFAULT 'sale' AFTER property_id
        `);
      } catch (addColErr) {
        console.error(
          '[featured_properties] Não foi possível ADD COLUMN scope (verifique o schema no MySQL):',
          addColErr
        );
      }
    }
    try {
      await connection.query(
        'ALTER TABLE featured_properties DROP PRIMARY KEY, ADD PRIMARY KEY (property_id, scope)'
      );
    } catch (pkErr) {
      console.error(
        '[featured_properties] Ajuste de chave primária (property_id, scope):',
        pkErr
      );
    }
    try {
      await connection.query(
        'ALTER TABLE featured_properties ADD UNIQUE KEY idx_featured_scope_position (scope, position)'
      );
    } catch {
      /* idempotente */
    }
  }
  if (await columnExists('featured_properties', 'scope')) {
    return;
  }
  console.error(
    "[featured_properties] Coluna 'scope' ainda inexistente após migração; listagem/edição de destaques irá falhar até o banco ser corrigido."
  );
}

async function ensureNotificationsType(): Promise<void> {
  if (!(await tableExists('notifications'))) {
    return;
  }

  const type = await getColumnType('notifications', 'related_entity_type');
  if (type && !type.includes('negotiation')) {
    await connection.query(
      "ALTER TABLE notifications MODIFY COLUMN related_entity_type ENUM('property','broker','agency','user','announcement','negotiation','other') NOT NULL"
    );
  }

  if (!(await columnExists('notifications', 'title'))) {
    await connection.query('ALTER TABLE notifications ADD COLUMN title VARCHAR(255) NULL');
  }

  if (!(await columnExists('notifications', 'metadata_json'))) {
    await connection.query('ALTER TABLE notifications ADD COLUMN metadata_json JSON NULL');
  }
}

async function ensureNegotiationsClientColumns(): Promise<void> {
  if (!(await tableExists('negotiations'))) {
    return;
  }

  if (!(await columnExists('negotiations', 'client_name'))) {
    await connection.query('ALTER TABLE negotiations ADD COLUMN client_name VARCHAR(255) NULL');
  }

  if (!(await columnExists('negotiations', 'client_cpf'))) {
    await connection.query('ALTER TABLE negotiations ADD COLUMN client_cpf VARCHAR(20) NULL');
  }

  await connection.query(`
    UPDATE negotiations
    SET client_name = COALESCE(
      NULLIF(client_name, ''),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.clientName')),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.client_name')),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.clientName')),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.client_name'))
    )
    WHERE (client_name IS NULL OR client_name = '')
      AND payment_details IS NOT NULL
  `);

  await connection.query(`
    UPDATE negotiations
    SET client_cpf = COALESCE(
      NULLIF(client_cpf, ''),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.clientCpf')),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.details.client_cpf')),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.clientCpf')),
      JSON_UNQUOTE(JSON_EXTRACT(payment_details, '$.client_cpf'))
    )
    WHERE (client_cpf IS NULL OR client_cpf = '')
      AND payment_details IS NOT NULL
  `);
}

async function ensureUserAddressColumns(): Promise<void> {
  if (!(await tableExists('users'))) {
    return;
  }

  if (!(await columnExists('users', 'street'))) {
    await connection.query('ALTER TABLE users ADD COLUMN street VARCHAR(255) NULL');
  }

  if (!(await columnExists('users', 'number'))) {
    await connection.query('ALTER TABLE users ADD COLUMN number VARCHAR(50) NULL');
  }

  if (!(await columnExists('users', 'complement'))) {
    await connection.query('ALTER TABLE users ADD COLUMN complement VARCHAR(255) NULL');
  }

  if (!(await columnExists('users', 'bairro'))) {
    await connection.query('ALTER TABLE users ADD COLUMN bairro VARCHAR(255) NULL');
  }

  if (!(await columnExists('users', 'cep'))) {
    await connection.query('ALTER TABLE users ADD COLUMN cep VARCHAR(20) NULL');
  }
}

async function ensureSupportRequestsTable(): Promise<void> {
  if (await tableExists('support_requests')) {
    return;
  }

  await connection.query(`
    CREATE TABLE support_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_support_requests_user_created (user_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

async function ensurePasswordResetTokensTable(): Promise<void> {
  if (await tableExists('password_reset_tokens')) {
    return;
  }

  await connection.query(`
    CREATE TABLE password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_password_reset_user (user_id),
      INDEX idx_password_reset_token (token_hash),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

async function ensureContractsTable(): Promise<void> {
  if (!(await tableExists('negotiations')) || !(await tableExists('properties'))) {
    return;
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
      negotiation_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
      property_id INT NOT NULL,
      status ENUM('AWAITING_DOCS', 'IN_DRAFT', 'AWAITING_SIGNATURES', 'FINALIZED') NOT NULL DEFAULT 'AWAITING_DOCS',
      seller_info JSON NULL,
      buyer_info JSON NULL,
      commission_data JSON NULL,
      workflow_metadata JSON NULL,
      seller_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING',
      buyer_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING',
      seller_approval_reason JSON NULL,
      buyer_approval_reason JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_contracts_negotiation (negotiation_id),
      KEY idx_contracts_property (property_id),
      KEY idx_contracts_status (status),
      CONSTRAINT fk_contracts_negotiation
        FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
      CONSTRAINT fk_contracts_property
        FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function ensureContractApprovalColumns(): Promise<void> {
  if (!(await tableExists('contracts'))) {
    return;
  }

  if (!(await columnExists('contracts', 'seller_approval_status'))) {
    await connection.query(`
      ALTER TABLE contracts
      ADD COLUMN seller_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      AFTER commission_data
    `);
  }

  if (!(await columnExists('contracts', 'buyer_approval_status'))) {
    await connection.query(`
      ALTER TABLE contracts
      ADD COLUMN buyer_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      AFTER seller_approval_status
    `);
  }

  if (!(await columnExists('contracts', 'seller_approval_reason'))) {
    await connection.query(`
      ALTER TABLE contracts
      ADD COLUMN seller_approval_reason JSON NULL
      AFTER buyer_approval_status
    `);
  }

  if (!(await columnExists('contracts', 'buyer_approval_reason'))) {
    await connection.query(`
      ALTER TABLE contracts
      ADD COLUMN buyer_approval_reason JSON NULL
      AFTER seller_approval_reason
    `);
  }

  const sellerApprovalType = await getColumnType('contracts', 'seller_approval_status');
  if (sellerApprovalType) {
    const lowerType = sellerApprovalType.toLowerCase();
    const missingValue = CONTRACT_APPROVAL_STATUS_VALUES.find(
      (value) => !lowerType.includes(`'${value.toLowerCase()}'`)
    );
    if (missingValue) {
      await connection.query(`
        ALTER TABLE contracts
        MODIFY COLUMN seller_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      `);
    }
  }

  const buyerApprovalType = await getColumnType('contracts', 'buyer_approval_status');
  if (buyerApprovalType) {
    const lowerType = buyerApprovalType.toLowerCase();
    const missingValue = CONTRACT_APPROVAL_STATUS_VALUES.find(
      (value) => !lowerType.includes(`'${value.toLowerCase()}'`)
    );
    if (missingValue) {
      await connection.query(`
        ALTER TABLE contracts
        MODIFY COLUMN buyer_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      `);
    }
  }
}

async function ensureContractWorkflowMetadataColumn(): Promise<void> {
  if (!(await tableExists('contracts'))) {
    return;
  }

  if (!(await columnExists('contracts', 'workflow_metadata'))) {
    await connection.query(`
      ALTER TABLE contracts
      ADD COLUMN workflow_metadata JSON NULL
      AFTER commission_data
    `);
  }
}

async function ensureNegotiationDocumentTypeColumn(): Promise<void> {
  if (!(await tableExists('negotiation_documents'))) {
    return;
  }

  if (!(await columnExists('negotiation_documents', 'document_type'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN document_type ENUM(${CONTRACT_DOCUMENT_TYPE_ENUM_SQL}) NULL AFTER type
    `);
    return;
  }

  const columnType = (await getColumnType('negotiation_documents', 'document_type'))?.toLowerCase();
  if (!columnType) {
    return;
  }

  const missingValue = CONTRACT_DOCUMENT_TYPE_VALUES.find(
    (value) => !columnType.includes(`'${value.toLowerCase()}'`)
  );

  if (missingValue) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      MODIFY COLUMN document_type ENUM(${CONTRACT_DOCUMENT_TYPE_ENUM_SQL}) NULL
    `);
  }
}

async function ensureNegotiationDocumentMetadataColumn(): Promise<void> {
  if (!(await tableExists('negotiation_documents'))) {
    return;
  }

  if (!(await columnExists('negotiation_documents', 'metadata_json'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN metadata_json JSON NULL AFTER document_type
    `);
  }
}

async function ensureNegotiationDocumentStorageColumns(): Promise<void> {
  if (!(await tableExists('negotiation_documents'))) {
    return;
  }

  if (!(await columnExists('negotiation_documents', 'storage_provider'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN storage_provider VARCHAR(32) NULL AFTER file_content
    `);
  }

  if (!(await columnExists('negotiation_documents', 'storage_bucket'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN storage_bucket VARCHAR(255) NULL AFTER storage_provider
    `);
  }

  if (!(await columnExists('negotiation_documents', 'storage_key'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN storage_key VARCHAR(1024) NULL AFTER storage_bucket
    `);
  }

  if (!(await columnExists('negotiation_documents', 'storage_content_type'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN storage_content_type VARCHAR(255) NULL AFTER storage_key
    `);
  }

  if (!(await columnExists('negotiation_documents', 'storage_size_bytes'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN storage_size_bytes BIGINT NULL AFTER storage_content_type
    `);
  }

  if (!(await columnExists('negotiation_documents', 'storage_etag'))) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN storage_etag VARCHAR(255) NULL AFTER storage_size_bytes
    `);
  }

  const fileContentType = await getColumnType('negotiation_documents', 'file_content');
  if (fileContentType && fileContentType.toLowerCase().includes('blob')) {
    await connection.query(`
      ALTER TABLE negotiation_documents
      MODIFY COLUMN file_content LONGBLOB NULL
    `);
  }
}

async function ensureAdminsTokenVersionColumn(): Promise<void> {
  if (!(await tableExists('admins'))) {
    return;
  }

  if (!(await columnExists('admins', 'token_version'))) {
    await connection.query(
      'ALTER TABLE admins ADD COLUMN token_version INT NOT NULL DEFAULT 1'
    );
  }

  await connection.query(
    'UPDATE admins SET token_version = 1 WHERE token_version IS NULL OR token_version < 1'
  );
}

async function ensureUsersTokenVersionColumn(): Promise<void> {
  if (!(await tableExists('users'))) {
    return;
  }

  if (!(await columnExists('users', 'token_version'))) {
    await connection.query(
      'ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 1'
    );
  }

  await connection.query(
    'UPDATE users SET token_version = 1 WHERE token_version IS NULL OR token_version < 1'
  );
}

async function ensureNegotiationResponsiblesAndBrokerProfileType(): Promise<void> {
  if (await tableExists('brokers')) {
    if (!(await columnExists('brokers', 'profile_type'))) {
      await connection.query(
        "ALTER TABLE brokers ADD COLUMN profile_type ENUM('BROKER','AUXILIARY_ADMINISTRATIVE') NOT NULL DEFAULT 'BROKER' AFTER status"
      );
    }

    const profileType = await getColumnType('brokers', 'profile_type');
    if (profileType && !profileType.includes('AUXILIARY_ADMINISTRATIVE')) {
      await connection.query(
        "ALTER TABLE brokers MODIFY COLUMN profile_type ENUM('BROKER','AUXILIARY_ADMINISTRATIVE') NOT NULL DEFAULT 'BROKER'"
      );
    }
  }

  if (
    !(await tableExists('negotiations')) ||
    !(await tableExists('users')) ||
    !(await tableExists('admins'))
  ) {
    return;
  }

  const negotiationIdMetadata = await getColumnMetadata('negotiations', 'id');
  const usersIdMetadata = await getColumnMetadata('users', 'id');
  const adminsIdMetadata = await getColumnMetadata('admins', 'id');

  const negotiationIdType = formatFkColumnType(
    negotiationIdMetadata,
    (await getColumnType('negotiations', 'id')) || 'CHAR(36)',
  );
  const usersIdType = formatFkColumnType(
    usersIdMetadata,
    (await getColumnType('users', 'id')) || 'INT',
  );
  const adminsIdType = formatFkColumnType(
    adminsIdMetadata,
    (await getColumnType('admins', 'id')) || 'INT',
  );

  const hasFk = await hasForeignKeyConstraint(
    'negotiation_responsibles',
    'fk_negotiation_responsibles_negotiation',
  );
  if (!(await tableExists('negotiation_responsibles'))) {
    await connection.query(`
      CREATE TABLE negotiation_responsibles (
        id INT PRIMARY KEY AUTO_INCREMENT,
        negotiation_id ${negotiationIdType} NOT NULL,
        user_id ${usersIdType} NOT NULL,
        assigned_by ${adminsIdType} NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_negotiation_responsibles_pair (negotiation_id, user_id),
        KEY idx_negotiation_responsibles_negotiation (negotiation_id),
        KEY idx_negotiation_responsibles_user (user_id),
        CONSTRAINT fk_negotiation_responsibles_negotiation
          FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE,
        CONSTRAINT fk_negotiation_responsibles_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_negotiation_responsibles_assigned_by
          FOREIGN KEY (assigned_by) REFERENCES admins(id) ON DELETE SET NULL
      )
    `);
    return;
  }

  const negotiationResponsibleIdMetadata = await getColumnMetadata(
    'negotiation_responsibles',
    'negotiation_id',
  );
  const shouldAlignNegotiationColumn = !isFkColumnCompatible(
    negotiationIdMetadata,
    negotiationResponsibleIdMetadata,
  );
  const shouldAlignUserColumn = !isFkColumnCompatible(
    usersIdMetadata,
    await getColumnMetadata('negotiation_responsibles', 'user_id'),
  );
  const hasUserFk = await hasForeignKeyConstraint(
    'negotiation_responsibles',
    'fk_negotiation_responsibles_user',
  );
  const shouldAlignAssignedByColumn = !isFkColumnCompatible(
    adminsIdMetadata,
    await getColumnMetadata('negotiation_responsibles', 'assigned_by'),
  );
  const hasAssignedByFk = await hasForeignKeyConstraint(
    'negotiation_responsibles',
    'fk_negotiation_responsibles_assigned_by',
  );

  let shouldRecreateFk = false;
  if (shouldAlignNegotiationColumn) {
    if (hasFk) {
      await connection.query(
        'ALTER TABLE negotiation_responsibles DROP FOREIGN KEY fk_negotiation_responsibles_negotiation',
      );
      shouldRecreateFk = true;
    }
    await connection.query(
      `ALTER TABLE negotiation_responsibles MODIFY COLUMN negotiation_id ${negotiationIdType} NOT NULL`,
    );
    shouldRecreateFk = true;
  }

  if (shouldAlignUserColumn) {
    if (hasUserFk) {
      await connection.query(
        'ALTER TABLE negotiation_responsibles DROP FOREIGN KEY fk_negotiation_responsibles_user',
      );
    }
    await connection.query(
      `ALTER TABLE negotiation_responsibles MODIFY COLUMN user_id ${usersIdType} NOT NULL`,
    );
  }

  if (shouldAlignAssignedByColumn) {
    if (hasAssignedByFk) {
      await connection.query(
        'ALTER TABLE negotiation_responsibles DROP FOREIGN KEY fk_negotiation_responsibles_assigned_by',
      );
    }
    await connection.query(
      `ALTER TABLE negotiation_responsibles MODIFY COLUMN assigned_by ${adminsIdType} NULL`,
    );
  }

  if (!hasFk || shouldRecreateFk) {
    await connection.query(
      `ALTER TABLE negotiation_responsibles
       ADD CONSTRAINT fk_negotiation_responsibles_negotiation
       FOREIGN KEY (negotiation_id) REFERENCES negotiations(id) ON DELETE CASCADE`,
    );
  }
  if (
    shouldAlignUserColumn
    || !(await hasForeignKeyConstraint('negotiation_responsibles', 'fk_negotiation_responsibles_user'))
  ) {
    await connection.query(
      `ALTER TABLE negotiation_responsibles
       ADD CONSTRAINT fk_negotiation_responsibles_user
       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`,
    );
  }
  if (
    shouldAlignAssignedByColumn
    || !(await hasForeignKeyConstraint(
      'negotiation_responsibles',
      'fk_negotiation_responsibles_assigned_by',
    ))
  ) {
    await connection.query(
      `ALTER TABLE negotiation_responsibles
       ADD CONSTRAINT fk_negotiation_responsibles_assigned_by
       FOREIGN KEY (assigned_by) REFERENCES admins(id) ON DELETE SET NULL`,
    );
  }
}

/**
 * ENUMs estreitos em negotiation_history / negotiations geram
 * "Data truncated" ao gravar transições (ex.: from_status=DOCUMENTATION_PHASE, to_status=REFUSED).
 * Normaliza colunas de status para VARCHAR quando ainda forem ENUM legado.
 */
async function ensureNegotiationStatusHistoryColumnsFreetext(): Promise<void> {
  if (await tableExists('negotiation_history')) {
    for (const col of ['from_status', 'to_status'] as const) {
      if (!(await columnExists('negotiation_history', col))) continue;
      const t = (await getColumnType('negotiation_history', col)) ?? '';
      if (t.toLowerCase().startsWith('enum(')) {
        await connection.query(
          `ALTER TABLE negotiation_history MODIFY COLUMN \`${col}\` VARCHAR(64) NOT NULL`
        );
      }
    }
  }

  if (await tableExists('negotiations') && (await columnExists('negotiations', 'status'))) {
    const t = (await getColumnType('negotiations', 'status')) ?? '';
    if (t.toLowerCase().startsWith('enum(') && !t.includes('REFUSED')) {
      await connection.query(
        `ALTER TABLE negotiations MODIFY COLUMN status VARCHAR(64) NOT NULL`
      );
    }
  }
}

async function ensurePropertyIndices(): Promise<void> {
  if (!(await tableExists('properties'))) return;

  const isTidb = String(process.env.DB_DIALECT ?? '').trim().toLowerCase() === 'tidb';
  const rawFullTextEnabled = String(process.env.PROPERTY_FULLTEXT_ENABLED ?? '').trim().toLowerCase();
  const isPropertyFullTextEnabled = rawFullTextEnabled.length > 0
    ? ['1', 'true', 'yes', 'on'].includes(rawFullTextEnabled)
    : !isTidb;
  const shouldLogFullTextDisabled = !isPropertyFullTextEnabled;

  if (shouldLogFullTextDisabled) {
    console.log('FULLTEXT de properties desativado por configuração.');
  }

  const addFullTextIndexIfSupported = async (
    indexName: string,
    columnName: string,
  ): Promise<void> => {
    if (shouldLogFullTextDisabled) {
      return;
    }

    if (await indexExists('properties', indexName)) return;

    const statement = `ALTER TABLE properties ADD FULLTEXT INDEX ${indexName} (${columnName})`;
    try {
      console.log(`Adicionando índice FULLTEXT em properties(${columnName})...`);
      await connection.query(statement);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isUnsupportedColumnarError =
        /Unsupported add columnar index|columnar replica must exist/i.test(message);

      if (isTidb || isUnsupportedColumnarError) {
        console.warn(
          'FULLTEXT opcional não pôde ser criado em properties; pulando para não quebrar startup/migrations em TiDB.',
          {
            table: 'properties',
            indexName,
            columnName,
            dialect: process.env.DB_DIALECT ?? null,
            reason: isUnsupportedColumnarError ? message : undefined,
          },
        );
        return;
      }

      throw error;
    }
  };

  // FullText Index for Search (Split for TiDB compatibility)
  await addFullTextIndexIfSupported('idx_properties_title_ft', 'title');
  await addFullTextIndexIfSupported('idx_properties_description_ft', 'description');

  // Price Index (Range filters)
  if (!(await indexExists('properties', 'idx_properties_price'))) {
    await connection.query('ALTER TABLE properties ADD INDEX idx_properties_price (price)');
  }

  // Type and Purpose (Category filters)
  if (!(await indexExists('properties', 'idx_properties_type'))) {
    await connection.query('ALTER TABLE properties ADD INDEX idx_properties_type (type)');
  }
  if (!(await indexExists('properties', 'idx_properties_purpose'))) {
    await connection.query('ALTER TABLE properties ADD INDEX idx_properties_purpose (purpose)');
  }

  // Created At (Newest sorting)
  if (!(await indexExists('properties', 'idx_properties_created'))) {
    await connection.query('ALTER TABLE properties ADD INDEX idx_properties_created (created_at)');
  }

  // Is Promoted (Featured filter)
  if (!(await indexExists('properties', 'idx_properties_promoted'))) {
    await connection.query('ALTER TABLE properties ADD INDEX idx_properties_promoted (is_promoted)');
  }
}

async function ensureGeneralIndices(): Promise<void> {
  // Negotiations
  if (await tableExists('negotiations')) {
    if (!(await indexExists('negotiations', 'idx_negotiations_status'))) {
      await connection.query('ALTER TABLE negotiations ADD INDEX idx_negotiations_status (status)');
    }
    if (!(await indexExists('negotiations', 'idx_negotiations_property'))) {
      await connection.query('ALTER TABLE negotiations ADD INDEX idx_negotiations_property (property_id)');
    }
  }

  // Users
  if (await tableExists('users')) {
    if (!(await indexExists('users', 'idx_users_name'))) {
      await connection.query('ALTER TABLE users ADD INDEX idx_users_name (name)');
    }
  }

  // Notifications
  if (await tableExists('notifications')) {
    if (!(await indexExists('notifications', 'idx_notifications_recipient_read'))) {
      await connection.query('ALTER TABLE notifications ADD INDEX idx_notifications_recipient_read (recipient_id, is_read)');
    }
  }
}

export async function applyMigrations(): Promise<void> {
  try {
    await ensurePropertiesColumns();
    await ensurePropertyEditRequestsTable();
    await ensureFeaturedPropertiesTable();
    await runFeaturedPropertiesScopeMigration();
    await ensureNotificationsType();
    await ensureNegotiationsClientColumns();
    await ensureUserAddressColumns();
    await ensureSupportRequestsTable();
    await ensurePasswordResetTokensTable();
    await ensureContractsTable();
    await ensureContractApprovalColumns();
    await ensureContractWorkflowMetadataColumn();
    await ensureNegotiationDocumentTypeColumn();
    await ensureNegotiationDocumentMetadataColumn();
    await ensureNegotiationDocumentStorageColumns();
    await ensureAdminsTokenVersionColumn();
    await ensureUsersTokenVersionColumn();
    await ensureNegotiationResponsiblesAndBrokerProfileType();
    await ensureNegotiationStatusHistoryColumnsFreetext();
    await ensurePropertyIndices();
    await ensureGeneralIndices();
    console.log('Migrations aplicadas com sucesso.');
  } catch (error) {
    console.error('Falha ao aplicar migrations:', error);
  }
}
