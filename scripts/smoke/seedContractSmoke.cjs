/*
 * Seeds only the isolated `imobiliaria_smoke_v2` schema used by the local
 * contract smoke test. It deliberately never connects to the configured
 * application database unless SMOKE_DATABASE is explicitly that schema.
 */
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { assertLocalOnlyDatabase, createLocalOnlyEnvironment } = require('./localOnlyRuntime.cjs');
const path = require('node:path');
// Smoke data must never inherit the repository's remote .env configuration.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local'), override: true });

const smokeDatabase = process.env.SMOKE_DATABASE || 'imobiliaria_smoke_v2';
const contractId = '00000000-0000-4000-8000-000000000101';
const negotiationId = '00000000-0000-4000-8000-000000000201';
const password = 'SmokePass!123';

Object.assign(process.env, createLocalOnlyEnvironment({
  database: smokeDatabase,
  port: '0',
  r2Bucket: smokeDatabase === 'encontre_aqui_pentest' ? 'imobiliaria-pentest' : 'imobiliaria-smoke',
  r2Prefix: 'contract-smoke',
  pdfServiceUrl: 'http://127.0.0.1:3336',
  pdfInternalApiKey: 'deal-e2e-local-key',
}));

function assertSmokeDatabase() {
  assertLocalOnlyDatabase(smokeDatabase, 'Seed de smoke de contratos');
}

function connectionConfig() {
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 4000),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: smokeDatabase,
    ssl: false,
  };
}

async function upsertUser(connection, { name, email, cpf, phone }) {
  const hash = await bcrypt.hash(password, 10);
  await connection.query(
    `
      INSERT INTO users (name, email, email_verified_at, password_hash, phone, city, state, cpf)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, 'Goiânia', 'GO', ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
        password_hash = VALUES(password_hash),
        phone = VALUES(phone),
        city = VALUES(city),
        state = VALUES(state),
        cpf = VALUES(cpf)
    `,
    [name, email, hash, phone, cpf]
  );
  const [rows] = await connection.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  return Number(rows[0].id);
}

async function upsertBroker(connection, userId, creci) {
  await connection.query(
    `
      INSERT INTO brokers (id, creci, status, profile_type)
      VALUES (?, ?, 'approved', 'BROKER')
      ON DUPLICATE KEY UPDATE
        creci = VALUES(creci),
        status = 'approved',
        profile_type = 'BROKER'
    `,
    [userId, creci]
  );
}

async function main() {
  assertSmokeDatabase();
  const connection = await mysql.createConnection(connectionConfig());
  try {
    const ownerId = await upsertUser(connection, {
      name: 'Smoke Proprietário',
      email: 'smoke-owner@example.test',
      cpf: '10000000001',
      phone: '+5564990000001',
    });
    const advertiserId = await upsertUser(connection, {
      name: 'Smoke Anunciante',
      email: 'smoke-advertiser@example.test',
      cpf: '10000000002',
      phone: '+5564990000002',
    });
    const buyerId = await upsertUser(connection, {
      name: 'Smoke Comprador',
      email: 'smoke-buyer@example.test',
      cpf: '10000000003',
      phone: '+5564990000003',
    });
    const captorId = await upsertUser(connection, {
      name: 'Smoke Captador Sem Vínculo',
      email: 'smoke-captor@example.test',
      cpf: '10000000004',
      phone: '+5564990000004',
    });
    const strangerId = await upsertUser(connection, {
      name: 'Smoke Externo',
      email: 'smoke-outsider@example.test',
      cpf: '10000000005',
      phone: '+5564990000005',
    });

    const responsibleIds = [];
    for (let number = 1; number <= 5; number += 1) {
      const id = await upsertUser(connection, {
        name: `Smoke Responsável ${number}`,
        email: `smoke-responsible-${number}@example.test`,
        cpf: `100000000${5 + number}`,
        phone: `+556499000001${number}`,
      });
      responsibleIds.push(id);
      await upsertBroker(connection, id, `SMK${100 + number}`);
    }
    await upsertBroker(connection, advertiserId, 'SMK201');
    await upsertBroker(connection, captorId, 'SMK202');

    await connection.query(
      `
        INSERT INTO properties (
          title, description, type, status, purpose, price, address, city, state,
          broker_id, owner_id, owner_name, owner_phone, code, lifecycle_status
        )
        VALUES (
          'Imóvel de Smoke - Responsáveis', 'Imóvel isolado para validação de contratos.',
          'Apartamento', 'negociacao', 'Venda', 450000.00, 'Rua Smoke, 101', 'Goiânia', 'GO',
          ?, ?, 'Smoke Proprietário', '+5564990000001', 'SMK-101', 'AVAILABLE'
        )
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id), broker_id = VALUES(broker_id), owner_id = VALUES(owner_id),
          status = 'negociacao', lifecycle_status = 'AVAILABLE'
      `,
      [captorId, ownerId]
    );
    const [propertyRows] = await connection.query(
      "SELECT id FROM properties WHERE code = 'SMK-101' LIMIT 1"
    );
    const propertyId = Number(propertyRows[0].id);

    const paymentDetails = JSON.stringify({
      method: 'MONEY',
      amount: 450000,
      details: { clientEmail: 'smoke-buyer@example.test', clientCpf: '10000000003' },
    });
    await connection.query(
      `
        INSERT INTO negotiations (
          id, property_id, capturing_broker_id, selling_broker_id, proposer_id, advertiser_id,
          initiator_side, legal_buyer_user_id, handshake_pin, handshake_status,
          handshake_attempts, deal_type, status, final_value, payment_details, client_name
        ) VALUES (?, ?, ?, ?, ?, ?, 'buyer', ?, NULL, 'VERIFIED', 0, 'sale', 'DOCUMENTATION_PHASE', ?, CAST(? AS JSON), 'Smoke Comprador')
        ON DUPLICATE KEY UPDATE
          property_id = VALUES(property_id), capturing_broker_id = VALUES(capturing_broker_id),
          selling_broker_id = VALUES(selling_broker_id), proposer_id = VALUES(proposer_id),
          advertiser_id = VALUES(advertiser_id), initiator_side = 'buyer',
          legal_buyer_user_id = VALUES(legal_buyer_user_id), handshake_pin = NULL,
          handshake_status = 'VERIFIED', handshake_attempts = 0, deal_type = 'sale',
          status = 'DOCUMENTATION_PHASE', final_value = VALUES(final_value),
          payment_details = VALUES(payment_details), client_name = 'Smoke Comprador'
      `,
      [
        negotiationId,
        propertyId,
        captorId,
        captorId,
        buyerId,
        advertiserId,
        buyerId,
        450000,
        paymentDetails,
      ]
    );

    const sellerInfo = JSON.stringify({ nome: 'Smoke Proprietário', cpf: '10000000001' });
    const buyerInfo = JSON.stringify({ nome: 'Smoke Comprador', cpf: '10000000003' });
    const workflowMetadata = JSON.stringify({ smoke: true, partyResolution: {} });
    await connection.query(
      `
        INSERT INTO contracts (
          id, negotiation_id, property_id, deal_type, status, seller_info, buyer_info,
          commission_data, workflow_metadata, seller_approval_status, buyer_approval_status
        ) VALUES (?, ?, ?, 'sale', 'AWAITING_DOCS', CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), 'PENDING', 'PENDING')
        ON DUPLICATE KEY UPDATE
          property_id = VALUES(property_id), deal_type = 'sale', status = 'AWAITING_DOCS',
          seller_info = VALUES(seller_info), buyer_info = VALUES(buyer_info),
          commission_data = VALUES(commission_data), workflow_metadata = VALUES(workflow_metadata),
          seller_approval_status = 'PENDING', buyer_approval_status = 'PENDING'
      `,
      [
        contractId,
        negotiationId,
        propertyId,
        sellerInfo,
        buyerInfo,
        JSON.stringify({ valorBaseComissao: 450000 }),
        workflowMetadata,
      ]
    );

    for (const responsibleId of responsibleIds) {
      await connection.query(
        `
          INSERT INTO negotiation_responsibles (negotiation_id, user_id, assigned_by)
          VALUES (?, ?, NULL)
          ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)
        `,
        [negotiationId, responsibleId]
      );
    }

    console.log(JSON.stringify({
      smokeDatabase,
      contractId,
      negotiationId,
      propertyId,
      accounts: {
        owner: 'smoke-owner@example.test',
        advertiser: 'smoke-advertiser@example.test',
        buyer: 'smoke-buyer@example.test',
        captor: 'smoke-captor@example.test',
        outsider: 'smoke-outsider@example.test',
        responsibles: responsibleIds.map((_, index) => `smoke-responsible-${index + 1}@example.test`),
      },
      password,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
