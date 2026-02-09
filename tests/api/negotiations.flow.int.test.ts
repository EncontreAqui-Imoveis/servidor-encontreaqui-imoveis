import request from 'supertest';
import jwt from 'jsonwebtoken';
import connection from '../../src/database/connection';
import { app } from '../../src/server';
import { cleanDb, closeDb } from '../helpers/testDb';

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret';

type SeedResult = {
  brokerToken: string;
  adminToken: string;
  propertyId: number;
  brokerId: number;
};

async function seedBaseData(): Promise<SeedResult> {
  await cleanDb();
  const conn = await connection.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    await conn.query(
      `INSERT INTO users (id, name, email)
       VALUES
         (1, 'Broker One', 'broker1@test.com'),
         (2, 'Broker Two', 'broker2@test.com'),
         (99, 'Admin', 'admin@test.com')`
    );

    await conn.query(
      `INSERT INTO brokers (id, creci, status)
       VALUES
         (1, '12345', 'approved'),
         (2, '54321', 'approved')
       ON DUPLICATE KEY UPDATE status = VALUES(status)`
    );

    await conn.query(
      `INSERT INTO properties (
        id, title, description, type, purpose, status, price, address, city, state,
        owner_id, visibility, lifecycle_status, sem_numero
      ) VALUES (
        101, 'Imovel Teste', 'Descricao', 'Casa', 'Venda', 'approved', 1000,
        'Rua A', 'Goiania', 'GO', 1, 'PUBLIC', 'AVAILABLE', 0
      )`
    );

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }

  return {
    brokerToken: jwt.sign({ id: 1, role: 'broker' }, JWT_SECRET, { expiresIn: '1h' }),
    adminToken: jwt.sign({ id: 99, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' }),
    propertyId: 101,
    brokerId: 1,
  };
}

async function createDraftNegotiation(token: string, propertyId: number): Promise<number> {
  const res = await request(app)
    .post('/negotiations')
    .set('Authorization', `Bearer ${token}`)
    .send({
      property_id: propertyId,
      captador_user_id: 1,
      seller_broker_user_id: 1,
    });
  expect(res.status).toBe(201);
  expect(res.body.status).toBe('DRAFT');
  return res.body.id;
}

describe('Negotiations Flow Integration', () => {
  afterAll(async () => {
    await closeDb();
  });

  it('admin activate hides property and moves status to DOCS_IN_REVIEW', async () => {
    const { brokerToken, adminToken, propertyId } = await seedBaseData();
    const negId = await createDraftNegotiation(brokerToken, propertyId);

    const submitRes = await request(app)
      .post(`/negotiations/${negId}/submit-for-activation`)
      .set('Authorization', `Bearer ${brokerToken}`);
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.status).toBe('PENDING_ACTIVATION');

    const activateRes = await request(app)
      .post(`/admin/negotiations/${negId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(activateRes.status).toBe(200);
    expect(activateRes.body.status).toBe('DOCS_IN_REVIEW');

    const [rows] = await connection.query(
      'SELECT visibility FROM properties WHERE id = ?',
      [propertyId]
    );
    const visibility = (rows as any[])[0]?.visibility;
    expect(visibility).toBe('HIDDEN');
  });

  it('uploads and reviews a document with mandatory comment for remarks/rejected', async () => {
    const { brokerToken, adminToken, propertyId } = await seedBaseData();
    const negId = await createDraftNegotiation(brokerToken, propertyId);

    await request(app)
      .post(`/negotiations/${negId}/submit-for-activation`)
      .set('Authorization', `Bearer ${brokerToken}`);

    await request(app)
      .post(`/admin/negotiations/${negId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const uploadRes = await request(app)
      .post(`/negotiations/${negId}/documents`)
      .set('Authorization', `Bearer ${brokerToken}`)
      .field('doc_name', 'Matricula')
      .field('doc_url', 'https://files.example/doc.pdf');

    expect(uploadRes.status).toBe(201);
    expect(uploadRes.body.status).toBe('PENDING_REVIEW');
    const docId = uploadRes.body.id;

    const badReview = await request(app)
      .post(`/admin/negotiations/${negId}/documents/${docId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' });
    expect(badReview.status).toBe(400);

    const okReview = await request(app)
      .post(`/admin/negotiations/${negId}/documents/${docId}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED_WITH_REMARKS', review_comment: 'Falta assinatura' });
    expect(okReview.status).toBe(200);
    expect(okReview.body.status).toBe('APPROVED_WITH_REMARKS');
  });

  it('publishes contract and creates signature with admin validation', async () => {
    const { brokerToken, adminToken, propertyId } = await seedBaseData();
    const negId = await createDraftNegotiation(brokerToken, propertyId);

    await request(app)
      .post(`/negotiations/${negId}/submit-for-activation`)
      .set('Authorization', `Bearer ${brokerToken}`);

    await request(app)
      .post(`/admin/negotiations/${negId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const contractRes = await request(app)
      .post(`/admin/negotiations/${negId}/contract`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('contract_url', 'https://files.example/contract-v1.pdf');
    expect(contractRes.status).toBe(200);
    expect(contractRes.body.version).toBe(1);

    const sigRes = await request(app)
      .post(`/negotiations/${negId}/signatures`)
      .set('Authorization', `Bearer ${brokerToken}`)
      .field('signed_by_role', 'SELLER_BROKER')
      .field('signed_file_url', 'https://files.example/signed.pdf');
    expect(sigRes.status).toBe(201);

    const sigId = sigRes.body.id;

    const badValidate = await request(app)
      .post(`/admin/negotiations/${negId}/signatures/${sigId}/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' });
    expect(badValidate.status).toBe(400);

    const okValidate = await request(app)
      .post(`/admin/negotiations/${negId}/signatures/${sigId}/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED', comment: 'Assinatura ilegivel' });
    expect(okValidate.status).toBe(200);
    expect(okValidate.body.validation_status).toBe('REJECTED');
  });

  it('submits close with splits and approves commission', async () => {
    const { brokerToken, adminToken, propertyId } = await seedBaseData();
    const negId = await createDraftNegotiation(brokerToken, propertyId);

    await request(app)
      .post(`/negotiations/${negId}/submit-for-activation`)
      .set('Authorization', `Bearer ${brokerToken}`);

    await request(app)
      .post(`/admin/negotiations/${negId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const closeRes = await request(app)
      .post(`/negotiations/${negId}/close/submit`)
      .set('Authorization', `Bearer ${brokerToken}`)
      .send({
        close_type: 'SOLD',
        commission_mode: 'PERCENT',
        commission_total_percent: 100,
        payment_proof_url: 'https://files.example/payment.pdf',
        splits: [
          { split_role: 'CAPTADOR', recipient_user_id: 1, percent_value: 30 },
          { split_role: 'PLATFORM', recipient_user_id: null, percent_value: 10 },
          { split_role: 'SELLER_BROKER', recipient_user_id: 1, percent_value: 60 },
        ],
      });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.close_type).toBe('SOLD');

    const approveRes = await request(app)
      .post(`/admin/negotiations/${negId}/close/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('SOLD_COMMISSIONED');

    const [rows] = await connection.query(
      'SELECT lifecycle_status FROM properties WHERE id = ?',
      [propertyId]
    );
    expect((rows as any[])[0]?.lifecycle_status).toBe('SOLD');
  });

  it('marks no commission with mandatory reason', async () => {
    const { brokerToken, adminToken, propertyId } = await seedBaseData();
    const negId = await createDraftNegotiation(brokerToken, propertyId);

    await request(app)
      .post(`/negotiations/${negId}/submit-for-activation`)
      .set('Authorization', `Bearer ${brokerToken}`);

    await request(app)
      .post(`/admin/negotiations/${negId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);

    await request(app)
      .post(`/negotiations/${negId}/close/submit`)
      .set('Authorization', `Bearer ${brokerToken}`)
      .send({
        close_type: 'RENTED',
        commission_mode: 'AMOUNT',
        commission_total_amount: 1000,
        payment_proof_url: 'https://files.example/payment.pdf',
        splits: [
          { split_role: 'CAPTADOR', recipient_user_id: 1, amount_value: 300 },
          { split_role: 'PLATFORM', recipient_user_id: null, amount_value: 200 },
          { split_role: 'SELLER_BROKER', recipient_user_id: 1, amount_value: 500 },
        ],
      });

    const badNoCommission = await request(app)
      .post(`/admin/negotiations/${negId}/close/no-commission`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(badNoCommission.status).toBe(400);

    const okNoCommission = await request(app)
      .post(`/admin/negotiations/${negId}/close/no-commission`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Isencao aprovada' });
    expect(okNoCommission.status).toBe(200);
    expect(okNoCommission.body.status).toBe('RENTED_NO_COMMISSION');
  });
});
