import { RowDataPacket } from 'mysql2';
import connection from './connection';
import { PROPERTY_TYPE_LEGACY_UPDATES } from '../utils/propertyTypes';

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

  if (!(await columnExists('properties', 'price_sale'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN price_sale DECIMAL(12, 2) NULL');
  }

  if (!(await columnExists('properties', 'price_rent'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN price_rent DECIMAL(12, 2) NULL');
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

  const purposeType = await getColumnType('properties', 'purpose');
  if (purposeType && !purposeType.includes('Venda e Aluguel')) {
    await connection.query(
      "ALTER TABLE properties MODIFY COLUMN purpose ENUM('Venda', 'Aluguel', 'Venda e Aluguel') NOT NULL"
    );
  }

  for (const { from, to } of PROPERTY_TYPE_LEGACY_UPDATES) {
    await connection.query(
      'UPDATE properties SET type = ? WHERE type = ?',
      [to, from]
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
      position INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (property_id),
      UNIQUE KEY idx_featured_position (position),
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);
}

async function ensureNotificationsType(): Promise<void> {
  if (!(await tableExists('notifications'))) {
    return;
  }

  const type = await getColumnType('notifications', 'related_entity_type');
  if (type && !type.includes('announcement')) {
    await connection.query(
      "ALTER TABLE notifications MODIFY COLUMN related_entity_type ENUM('property','broker','agency','user','announcement','other') NOT NULL"
    );
  }
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

export async function applyMigrations(): Promise<void> {
  try {
    await ensurePropertiesColumns();
    await ensureFeaturedPropertiesTable();
    await ensureNotificationsType();
    await ensureUserAddressColumns();
    await ensureSupportRequestsTable();
    await ensurePasswordResetTokensTable();
    console.log('Migrations aplicadas com sucesso.');
  } catch (error) {
    console.error('Falha ao aplicar migrations:', error);
  }
}
