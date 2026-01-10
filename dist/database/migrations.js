"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMigrations = applyMigrations;
const connection_1 = __importDefault(require("./connection"));
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
async function ensurePropertiesColumns() {
    if (!(await columnExists('properties', 'owner_id'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN owner_id INT NULL');
    }
    if (!(await columnExists('properties', 'price_sale'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN price_sale DECIMAL(12, 2) NULL');
    }
    if (!(await columnExists('properties', 'price_rent'))) {
        await connection_1.default.query('ALTER TABLE properties ADD COLUMN price_rent DECIMAL(12, 2) NULL');
    }
    const purposeType = await getColumnType('properties', 'purpose');
    if (purposeType && !purposeType.includes('Venda e Aluguel')) {
        await connection_1.default.query("ALTER TABLE properties MODIFY COLUMN purpose ENUM('Venda', 'Aluguel', 'Venda e Aluguel') NOT NULL");
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
async function applyMigrations() {
    try {
        await ensurePropertiesColumns();
        await ensureFeaturedPropertiesTable();
        console.log('Migrations aplicadas com sucesso.');
    }
    catch (error) {
        console.error('Falha ao aplicar migrations:', error);
    }
}
