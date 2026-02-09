import request from 'supertest';
import { app } from '../../src/server';
import connection from '../../src/database/connection';
import { cleanDb, closeDb } from '../helpers/testDb';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test_secret'; // Ensure this matches env or is set

describe('Negotiations API Integration', () => {
    let brokerToken: string;
    let adminToken: string;
    let brokerId = 1;

    beforeAll(async () => {
        // Ensure env is loaded? server.ts does it.
    });

    afterAll(async () => {
        await closeDb();
    });

    beforeEach(async () => {
        await cleanDb();
        const conn = await connection.getConnection();
        try {
            await conn.query('SET FOREIGN_KEY_CHECKS = 0');

            // Insert User (Broker)
            await conn.query(`INSERT IGNORE INTO users (id, name, email) VALUES 
            (1, "Broker User", "broker@test.com")`);

            // Insert Broker record (required for auth middleware)
            // Check broker table schema? Assuming id matches user_id or similar.
            // Usually brokers table has id, user_id? Or id IS user_id?
            // Let's assume id is shared or user_id FK.
            // Checking auth.ts: 'SELECT status FROM brokers WHERE id = ?', [req.userId]
            // So brokers table uses same ID as users table (1:1 mapping probably).

            // Need to know brokers schema. Assuming basics.
            // If unknown, I might fail here. But let's try.
            await conn.query(`INSERT IGNORE INTO brokers (id, status, creci) VALUES 
            (1, "approved", "12345")`);

            // Insert Property
            await conn.query(`INSERT IGNORE INTO properties (
              id, title, description, type, purpose, status, price, address, city, state,
              owner_id, visibility, lifecycle_status, sem_numero
            ) VALUES (
              101, "Test API Prop", "Descricao", "Casa", "Venda", "approved", 1000,
              "Rua A", "Goiania", "GO", 1, "PUBLIC", "AVAILABLE", 0
            )`);

            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        } finally {
            conn.release();
        }

        brokerToken = jwt.sign({ id: 1, role: 'broker' }, JWT_SECRET, { expiresIn: '1h' });
        adminToken = jwt.sign({ id: 2, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    });

    it('POST /negotiations - should create a draft negotiation', async () => {
        const res = await request(app)
            .post('/negotiations')
            .set('Authorization', `Bearer ${brokerToken}`)
            .send({
                property_id: 101,
                captador_user_id: 1, // Self
                seller_broker_user_id: 1 // Self
            });

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('id');
        expect(res.body.status).toBe('DRAFT');
    });

    it('POST /negotiations/:id/submit-for-activation - should submit draft', async () => {
        // First create draft
        const createRes = await request(app)
            .post('/negotiations')
            .set('Authorization', `Bearer ${brokerToken}`)
            .send({
                property_id: 101,
                captador_user_id: 1,
                seller_broker_user_id: 1
            });

        const negId = createRes.body.id;

        // Then submit
        const res = await request(app)
            .post(`/negotiations/${negId}/submit-for-activation`)
            .set('Authorization', `Bearer ${brokerToken}`);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PENDING_ACTIVATION');
    });
});
