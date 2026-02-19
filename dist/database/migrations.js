"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
const connection_1 = __importDefault(require("./connection"));
const propertyTypes_1 = require("../utils/propertyTypes");
async function tableExists(tableName) {
    const [rows] = await connection_1.default.query(`
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1
    `, [tableName]);
    return rows.length > 0;
}
async function columnExists(tableName, columnName) {
    const [rows] = await connection_1.default.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `, [tableName, columnName]);
    return rows.length > 0;
}
async function getColumnType(tableName, columnName) {
    const [rows] = await connection_1.default.query(`
      SELECT column_type
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `, [tableName, columnName]);
    return rows[0]?.column_type ?? null;
}
const CONTRACT_DOCUMENT_TYPE_VALUES = [
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
];
const CONTRACT_DOCUMENT_TYPE_ENUM_SQL = CONTRACT_DOCUMENT_TYPE_VALUES.map((value) => `'${value}'`).join(', ');
const CONTRACT_APPROVAL_STATUS_VALUES = [
    'PENDING',
    'APPROVED',
    'APPROVED_WITH_RES',
    'REJECTED',
];
const CONTRACT_APPROVAL_STATUS_ENUM_SQL = CONTRACT_APPROVAL_STATUS_VALUES.map((value) => `'${value}'`).join(', ');
async function ensurePropertiesColumns() {
    if (!(await columnExists('properties', 'owner_id'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN owner_id INT NULL');
    }
    if (!(await columnExists('properties', 'owner_name'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN owner_name VARCHAR(255) NULL');
    }
    if (!(await columnExists('properties', 'owner_phone'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN owner_phone VARCHAR(50) NULL');
    }
    if (!(await columnExists('properties', 'cep'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN cep VARCHAR(20) NULL');
    }
    if (!(await columnExists('properties', 'price_sale'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN price_sale DECIMAL(12, 2) NULL');
    }
    if (!(await columnExists('properties', 'price_rent'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN price_rent DECIMAL(12, 2) NULL');
    }
    if (!(await columnExists('properties', 'is_promoted'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN is_promoted TINYINT(1) NOT NULL DEFAULT 0');
    }
    if (!(await columnExists('properties', 'promotion_percentage'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN promotion_percentage DECIMAL(5, 2) NULL');
    }
    if (!(await columnExists('properties', 'promotion_start'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN promotion_start DATETIME NULL');
    }
    if (!(await columnExists('properties', 'promotion_end'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN promotion_end DATETIME NULL');
    }
    if (!(await columnExists('properties', 'promo_percentage'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN promo_percentage DECIMAL(5, 2) NULL');
    }
    if (!(await columnExists('properties', 'promo_start_date'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN promo_start_date DATE NULL');
    }
    if (!(await columnExists('properties', 'promo_end_date'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN promo_end_date DATE NULL');
    }
    if (!(await columnExists('properties', 'quadra'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN quadra VARCHAR(100) NULL');
    }
    if (!(await columnExists('properties', 'lote'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN lote VARCHAR(100) NULL');
    }
    const quadraType = await getColumnType('properties', 'quadra');
    if (quadraType && !quadraType.toLowerCase().includes('varchar')) {
        await connection_1.default.query('ALTER TABLE properties MODIFY COLUMN quadra VARCHAR(100) NULL');
    }
    const loteType = await getColumnType('properties', 'lote');
    if (loteType && !loteType.toLowerCase().includes('varchar')) {
        await connection_1.default.query('ALTER TABLE properties MODIFY COLUMN lote VARCHAR(100) NULL');
    }
    const purposeType = await getColumnType('properties', 'purpose');
    if (purposeType && !purposeType.includes('Venda e Aluguel')) {
        await connection_1.default.query("ALTER TABLE properties MODIFY COLUMN purpose ENUM('Venda', 'Aluguel', 'Venda e Aluguel') NOT NULL");
    }
    for (const { from, to } of propertyTypes_1.PROPERTY_TYPE_LEGACY_UPDATES) {
        await connection_1.default.query('UPDATE properties SET type = ? WHERE type = ?', [to, from]);
    }
}
async function ensureFeaturedPropertiesTable() {
    if (await tableExists('featured_properties')) {
        return;
    }
    await connection_1.default.query(`
    CREATE TABLE featured_properties (
      property_id INT NOT NULL,
      position INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id),
      UNIQUE KEY idx_featured_position (position),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);
}
async function ensureNotificationsType() {
    if (!(await tableExists('notifications'))) {
        return;
    }
    const type = await getColumnType('notifications', 'related_entity_type');
    if (type && !type.includes('negotiation')) {
        await connection_1.default.query("ALTER TABLE notifications MODIFY COLUMN related_entity_type ENUM('property','broker','agency','user','announcement','negotiation','other') NOT NULL");
    }
    if (!(await columnExists('notifications', 'title'))) {
        await connection_1.default.query('ALTER TABLE notifications ADD COLUMN title VARCHAR(255) NULL');
    }
    if (!(await columnExists('notifications', 'metadata_json'))) {
        await connection_1.default.query('ALTER TABLE notifications ADD COLUMN metadata_json JSON NULL');
    }
}
async function ensureNegotiationsClientColumns() {
    if (!(await tableExists('negotiations'))) {
        return;
    }
    if (!(await columnExists('negotiations', 'client_name'))) {
        await connection_1.default.query('ALTER TABLE negotiations ADD COLUMN client_name VARCHAR(255) NULL');
    }
    if (!(await columnExists('negotiations', 'client_cpf'))) {
        await connection_1.default.query('ALTER TABLE negotiations ADD COLUMN client_cpf VARCHAR(20) NULL');
    }
    await connection_1.default.query(`
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
    await connection_1.default.query(`
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
async function ensureUserAddressColumns() {
    if (!(await tableExists('users'))) {
        return;
    }
    if (!(await columnExists('users', 'street'))) {
        await connection_1.default.query('ALTER TABLE users ADD COLUMN street VARCHAR(255) NULL');
    }
    if (!(await columnExists('users', 'number'))) {
        await connection_1.default.query('ALTER TABLE users ADD COLUMN number VARCHAR(50) NULL');
    }
    if (!(await columnExists('users', 'complement'))) {
        await connection_1.default.query('ALTER TABLE users ADD COLUMN complement VARCHAR(255) NULL');
    }
    if (!(await columnExists('users', 'bairro'))) {
        await connection_1.default.query('ALTER TABLE users ADD COLUMN bairro VARCHAR(255) NULL');
    }
    if (!(await columnExists('users', 'cep'))) {
        await connection_1.default.query('ALTER TABLE users ADD COLUMN cep VARCHAR(20) NULL');
    }
}
async function ensureSupportRequestsTable() {
    if (await tableExists('support_requests')) {
        return;
    }
    await connection_1.default.query(`
    CREATE TABLE support_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_support_requests_user_created (user_id, created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}
async function ensurePasswordResetTokensTable() {
    if (await tableExists('password_reset_tokens')) {
        return;
    }
    await connection_1.default.query(`
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
async function ensureContractsTable() {
    if (!(await tableExists('negotiations')) || !(await tableExists('properties'))) {
        return;
    }
    await connection_1.default.query(`
    CREATE TABLE IF NOT EXISTS contracts (
      id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
      negotiation_id CHAR(36) COLLATE utf8mb4_0900_ai_ci NOT NULL,
      property_id INT NOT NULL,
      status ENUM('AWAITING_DOCS', 'IN_DRAFT', 'AWAITING_SIGNATURES', 'FINALIZED') NOT NULL DEFAULT 'AWAITING_DOCS',
      seller_info JSON NULL,
      buyer_info JSON NULL,
      commission_data JSON NULL,
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
async function ensureContractApprovalColumns() {
    if (!(await tableExists('contracts'))) {
        return;
    }
    if (!(await columnExists('contracts', 'seller_approval_status'))) {
        await connection_1.default.query(`
      ALTER TABLE contracts
      ADD COLUMN seller_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      AFTER commission_data
    `);
    }
    if (!(await columnExists('contracts', 'buyer_approval_status'))) {
        await connection_1.default.query(`
      ALTER TABLE contracts
      ADD COLUMN buyer_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      AFTER seller_approval_status
    `);
    }
    if (!(await columnExists('contracts', 'seller_approval_reason'))) {
        await connection_1.default.query(`
      ALTER TABLE contracts
      ADD COLUMN seller_approval_reason JSON NULL
      AFTER buyer_approval_status
    `);
    }
    if (!(await columnExists('contracts', 'buyer_approval_reason'))) {
        await connection_1.default.query(`
      ALTER TABLE contracts
      ADD COLUMN buyer_approval_reason JSON NULL
      AFTER seller_approval_reason
    `);
    }
    const sellerApprovalType = await getColumnType('contracts', 'seller_approval_status');
    if (sellerApprovalType) {
        const lowerType = sellerApprovalType.toLowerCase();
        const missingValue = CONTRACT_APPROVAL_STATUS_VALUES.find((value) => !lowerType.includes(`'${value.toLowerCase()}'`));
        if (missingValue) {
            await connection_1.default.query(`
        ALTER TABLE contracts
        MODIFY COLUMN seller_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      `);
        }
    }
    const buyerApprovalType = await getColumnType('contracts', 'buyer_approval_status');
    if (buyerApprovalType) {
        const lowerType = buyerApprovalType.toLowerCase();
        const missingValue = CONTRACT_APPROVAL_STATUS_VALUES.find((value) => !lowerType.includes(`'${value.toLowerCase()}'`));
        if (missingValue) {
            await connection_1.default.query(`
        ALTER TABLE contracts
        MODIFY COLUMN buyer_approval_status ENUM(${CONTRACT_APPROVAL_STATUS_ENUM_SQL}) NOT NULL DEFAULT 'PENDING'
      `);
        }
    }
}
async function ensureNegotiationDocumentTypeColumn() {
    if (!(await tableExists('negotiation_documents'))) {
        return;
    }
    if (!(await columnExists('negotiation_documents', 'document_type'))) {
        await connection_1.default.query(`
      ALTER TABLE negotiation_documents
      ADD COLUMN document_type ENUM(${CONTRACT_DOCUMENT_TYPE_ENUM_SQL}) NULL AFTER type
    `);
        return;
    }
    const columnType = (await getColumnType('negotiation_documents', 'document_type'))?.toLowerCase();
    if (!columnType) {
        return;
    }
    const missingValue = CONTRACT_DOCUMENT_TYPE_VALUES.find((value) => !columnType.includes(`'${value.toLowerCase()}'`));
    if (missingValue) {
        await connection_1.default.query(`
      ALTER TABLE negotiation_documents
      MODIFY COLUMN document_type ENUM(${CONTRACT_DOCUMENT_TYPE_ENUM_SQL}) NULL
    `);
    }
}
async function applyMigrations() {
    try {
        await ensurePropertiesColumns();
        await ensureFeaturedPropertiesTable();
        await ensureNotificationsType();
        await ensureNegotiationsClientColumns();
        await ensureUserAddressColumns();
        await ensureSupportRequestsTable();
        await ensurePasswordResetTokensTable();
        await ensureContractsTable();
        await ensureContractApprovalColumns();
        await ensureNegotiationDocumentTypeColumn();
        console.log('Migrations aplicadas com sucesso.');
    }
    catch (error) {
        console.error('Falha ao aplicar migrations:', error);
    }
}
