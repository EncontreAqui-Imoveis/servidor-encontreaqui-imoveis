import { RowDataPacket } from 'mysql2';
import connection from './connection';

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

  if (!(await columnExists('properties', 'price_sale'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN price_sale DECIMAL(12, 2) NULL');
  }

  if (!(await columnExists('properties', 'price_rent'))) {
    await connection.query('ALTER TABLE properties ADD COLUMN price_rent DECIMAL(12, 2) NULL');
  }

  const purposeType = await getColumnType('properties', 'purpose');
  if (purposeType && !purposeType.includes('Venda e Aluguel')) {
    await connection.query(
      "ALTER TABLE properties MODIFY COLUMN purpose ENUM('Venda', 'Aluguel', 'Venda e Aluguel') NOT NULL"
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

export async function applyMigrations(): Promise<void> {
  try {
    await ensurePropertiesColumns();
    await ensureFeaturedPropertiesTable();
    console.log('Migrations aplicadas com sucesso.');
  } catch (error) {
    console.error('Falha ao aplicar migrations:', error);
  }
}
