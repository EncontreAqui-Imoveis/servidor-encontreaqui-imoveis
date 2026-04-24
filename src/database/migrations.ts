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

/** Tabelas antigas: PK só em property_id; evolui para (property_id, scope) e posição única por escopo. */
async function migrateFeaturedPropertiesScope(): Promise<void> {
  if (!(await tableExists('featured_properties'))) {
    return;
  }
  if (await columnExists('featured_properties', 'scope')) {
    return;
  }

  await connection.query('ALTER TABLE featured_properties DROP INDEX idx_featured_position');
  await connection.query('ALTER TABLE featured_properties DROP PRIMARY KEY');
  await connection.query(`
    ALTER TABLE featured_properties
      ADD COLUMN scope ENUM('sale', 'rent') NOT NULL DEFAULT 'sale' AFTER property_id
  `);
  await connection.query(
    'ALTER TABLE featured_properties ADD PRIMARY KEY (property_id, scope)'
  );
  await connection.query(
    'ALTER TABLE featured_properties ADD UNIQUE KEY idx_featured_scope_position (scope, position)'
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

  if (!(await tableExists('negotiation_responsibles'))) {
    await connection.query(`
      CREATE TABLE negotiation_responsibles (
        id INT PRIMARY KEY AUTO_INCREMENT,
        negotiation_id CHAR(36) NOT NULL,
        user_id INT NOT NULL,
        assigned_by INT NULL,
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
  }
}

export async function applyMigrations(): Promise<void> {
  try {
    await ensurePropertiesColumns();
    await ensurePropertyEditRequestsTable();
    await ensureFeaturedPropertiesTable();
    await migrateFeaturedPropertiesScope();
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
    console.log('Migrations aplicadas com sucesso.');
  } catch (error) {
    console.error('Falha ao aplicar migrations:', error);
  }
}
