"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const connection_1 = __importDefault(require("./connection"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const createTables = async () => {
    const adminsTable = `
    CREATE TABLE IF NOT EXISTS admins (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'admin',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
    const usersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NULL,
      address VARCHAR(255) NULL,
      city VARCHAR(100) NULL,
      state VARCHAR(50) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
    const brokersTable = `
    CREATE TABLE IF NOT EXISTS brokers (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      creci VARCHAR(20) NOT NULL UNIQUE,
      address VARCHAR(255) NULL,
      city VARCHAR(100) NULL,
      state VARCHAR(50) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
    const propertiesTable = `
    CREATE TABLE IF NOT EXISTS properties (
      id INT PRIMARY KEY AUTO_INCREMENT,
      title VARCHAR(255) NOT NULL,
      description TEXT NOT NULL,
      type ENUM('Casa', 'Apartamento', 'Terreno') NOT NULL,
      status ENUM('Disponível', 'Negociando', 'Vendido', 'Alugado') NOT NULL DEFAULT 'Disponível',
      purpose ENUM('Venda', 'Aluguel') NOT NULL,
      price DECIMAL(10, 2) NOT NULL,
      address VARCHAR(255) NOT NULL,
      city VARCHAR(100) NOT NULL,
      state VARCHAR(50) NOT NULL,
      bedrooms INT NULL,
      bathrooms INT NULL,
      area INT NULL,
      garage_spots INT NULL DEFAULT 0, 
      has_wifi BOOLEAN NULL DEFAULT true,
      broker_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (broker_id) REFERENCES brokers(id) ON DELETE SET NULL
      sale_value DECIMAL(12, 2) NULL,
      commission_value DECIMAL(12, 2) NULL;
    );
  `;
    const propertyImagesTable = `
    CREATE TABLE IF NOT EXISTS property_images (
      id INT PRIMARY KEY AUTO_INCREMENT,
      property_id INT NOT NULL,
      image_url VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    );
  `;
    const salesTable = `
    CREATE TABLE IF NOT EXISTS sales (
      id INT PRIMARY KEY AUTO_INCREMENT,
      property_id INT NOT NULL,
      broker_id INT NOT NULL,
      sale_price DECIMAL(10, 2) NOT NULL,
      commission_rate DECIMAL(5, 2) NOT NULL DEFAULT 5.00, -- Ex: 5.00 para 5%
      commission_amount DECIMAL(10, 2) NOT NULL,
      sale_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
      FOREIGN KEY (broker_id) REFERENCES brokers(id) ON DELETE CASCADE
    );
  `;
    const brokerDocumentsTable = `
    CREATE TABLE IF NOT EXISTS broker_documents (
      broker_id INT PRIMARY KEY,
      creci_front_url VARCHAR(255) NOT NULL,
      creci_back_url VARCHAR(255) NOT NULL,
      selfie_url VARCHAR(255) NOT NULL,
      status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (broker_id) REFERENCES brokers(id) ON DELETE CASCADE
    );
  `;
    try {
        console.log('Criando tabela de administradores (admins)...');
        await connection_1.default.query(adminsTable);
        console.log('Criando tabela de corretores (brokers)...');
        await connection_1.default.query(brokersTable);
        console.log('Criando tabela de usuários (users)...');
        await connection_1.default.query(usersTable);
        console.log('Criando tabela de imóveis (properties)...');
        await connection_1.default.query(propertiesTable);
        console.log('Criando tabela de imagens dos imóveis (property_images)...');
        await connection_1.default.query(propertyImagesTable);
        console.log('Criando tabela de vendas (sales)...');
        await connection_1.default.query(salesTable);
        console.log('Criando tabela de documentos dos corretores (broker_documents)...');
        await connection_1.default.query(brokerDocumentsTable);
        const adminEmail = 'admin@imobiliaria.com';
        const adminPassword = 'admin123';
        const [existingAdmin] = await connection_1.default.query('SELECT id FROM admins WHERE email = ?', [adminEmail]);
        if (Array.isArray(existingAdmin) && existingAdmin.length === 0) {
            console.log('Criando administrador padrão...');
            const password_hash = await bcryptjs_1.default.hash(adminPassword, 8);
            await connection_1.default.query('INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)', ['Admin Padrão', adminEmail, password_hash]);
            console.log('Administrador padrão criado com sucesso!');
        }
        console.log('Todas as tabelas foram verificadas/criadas com sucesso!');
    }
    catch (error) {
        console.error('Erro ao inicializar o banco de dados:', error);
    }
    finally {
        await connection_1.default.end();
    }
};
createTables();
