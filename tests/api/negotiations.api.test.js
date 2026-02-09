"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const server_1 = require("../../src/server");
const connection_1 = __importDefault(require("../../src/database/connection"));
const testDb_1 = require("../helpers/testDb");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'test_secret'; // Ensure this matches env or is set
describe('Negotiations API Integration', () => {
    let brokerToken;
    let adminToken;
    let brokerId = 1;
    beforeAll(async () => {
        // Ensure env is loaded? server.ts does it.
    });
    afterAll(async () => {
        await (0, testDb_1.closeDb)();
    });
    beforeEach(async () => {
        await (0, testDb_1.cleanDb)();
        const conn = await connection_1.default.getConnection();
        try {
            await conn.query('SET FOREIGN_KEY_CHECKS = 0');
            // Insert User (Broker)
            await conn.query(`INSERT IGNORE INTO users (id, name, email, role) VALUES 
            (1, "Broker User", "broker@test.com", "BROKER")`);
            // Insert Broker record (required for auth middleware)
            // Check broker table schema? Assuming id matches user_id or similar.
            // Usually brokers table has id, user_id? Or id IS user_id?
            // Let's assume id is shared or user_id FK.
            // Checking auth.ts: 'SELECT status FROM brokers WHERE id = ?', [req.userId]
            // So brokers table uses same ID as users table (1:1 mapping probably).
            // Need to know brokers schema. Assuming basics.
            // If unknown, I might fail here. But let's try.
            await conn.query(`INSERT IGNORE INTO brokers (id, status, creci, state) VALUES 
            (1, "approved", "12345", "SP")`);
            // Insert Property
            await conn.query(`INSERT IGNORE INTO properties (id, title, owner_id, status, visibility, lifecycle_status, sem_numero) VALUES 
            (101, "Test API Prop", 1, "approved", "PUBLIC", "AVAILABLE", 0)`);
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }
        finally {
            conn.release();
        }
        brokerToken = jsonwebtoken_1.default.sign({ id: 1, role: 'broker' }, JWT_SECRET, { expiresIn: '1h' });
        adminToken = jsonwebtoken_1.default.sign({ id: 2, role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    });
    it('POST /negotiations - should create a draft negotiation', async () => {
        const res = await (0, supertest_1.default)(server_1.app)
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
        const createRes = await (0, supertest_1.default)(server_1.app)
            .post('/negotiations')
            .set('Authorization', `Bearer ${brokerToken}`)
            .send({
            property_id: 101,
            captador_user_id: 1,
            seller_broker_user_id: 1
        });
        const negId = createRes.body.id;
        // Then submit
        const res = await (0, supertest_1.default)(server_1.app)
            .post(`/negotiations/${negId}/submit-for-activation`)
            .set('Authorization', `Bearer ${brokerToken}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('PENDING_ACTIVATION');
    });
});
