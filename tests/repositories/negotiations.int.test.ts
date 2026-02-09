import connection from '../../src/database/connection';
import { cleanDb, closeDb } from '../helpers/testDb';
import { NegotiationRepository } from '../../src/modules/negociacoes/infra/NegotiationRepository';
import { NegotiationDocumentsRepository } from '../../src/modules/negociacoes/infra/NegotiationDocumentsRepository';
import { NegotiationContractsRepository } from '../../src/modules/negociacoes/infra/NegotiationContractsRepository';

const negotiationRepo = new NegotiationRepository();
const docsRepo = new NegotiationDocumentsRepository();
const contractsRepo = new NegotiationContractsRepository();

describe('Negotiation Repositories Integration', () => {
    beforeEach(async () => {
        try {
            console.log('Starting CleanDb');
            await cleanDb();
            console.log('CleanDb finished');
            const conn = await connection.getConnection();
            try {
                await conn.query('SET FOREIGN_KEY_CHECKS = 0');
                // Insert with all potential required fields filled with dummies or just basic info if strict mode allows.
                await conn.query(`INSERT IGNORE INTO users (id, name, email) VALUES 
                    (1, "Captador", "c@test.com"),
                    (2, "Seller", "s@test.com"),
                    (3, "Admin", "a@test.com")`);

                await conn.query(`INSERT IGNORE INTO properties (id, title, owner_id, status, visibility, lifecycle_status, sem_numero) VALUES 
                    (101, "Test Prop", 1, "approved", "PUBLIC", "AVAILABLE", 0)`);

                await conn.query('SET FOREIGN_KEY_CHECKS = 1');
                console.log('Setup complete');
            } finally {
                conn.release();
            }
        } catch (err) {
            console.error('SETUP ERROR:', err);
            throw err;
        }
    });

    afterAll(async () => {
        await closeDb();
    });

    it('should create and retrieve a negotiation', async () => {
        const negId = await negotiationRepo.create({
            propertyId: 101,
            captadorUserId: 1,
            sellerBrokerUserId: 2,
            createdByUserId: 2
        });

        const neg = await negotiationRepo.findById(negId);
        expect(neg).toBeDefined();
        expect(neg?.id).toBe(negId);
        expect(neg?.status).toBe('DRAFT');
        expect(neg?.active).toBe(0);
    });

    it('should update negotiation status', async () => {
        const negId = await negotiationRepo.create({
            propertyId: 101,
            captadorUserId: 1,
            sellerBrokerUserId: 2,
            createdByUserId: 2
        });

        await negotiationRepo.updateStatus({ id: negId, status: 'PENDING_ACTIVATION' });
        const neg = await negotiationRepo.findById(negId);
        expect(neg?.status).toBe('PENDING_ACTIVATION');
    });

    it('should activate a negotiation', async () => {
        const negId = await negotiationRepo.create({
            propertyId: 101,
            captadorUserId: 1,
            sellerBrokerUserId: 2,
            createdByUserId: 2
        });

        await negotiationRepo.updateStatus({
            id: negId,
            status: 'DOCS_IN_REVIEW',
            active: 1,
            startedAt: new Date('2026-12-01'),
            expiresAt: new Date('2026-12-31')
        });

        const neg = await negotiationRepo.findById(negId);
        expect(neg?.active).toBe(1);
        expect(neg?.status).toBe('DOCS_IN_REVIEW');
        expect(neg?.started_at).toBeDefined();
        expect(neg?.expires_at).toBeDefined();
    });

    it('should create and find documents', async () => {
        const negId = await negotiationRepo.create({
            propertyId: 101,
            captadorUserId: 1,
            sellerBrokerUserId: 2,
            createdByUserId: 2
        });

        await docsRepo.create({
            negotiation_id: negId,
            doc_name: 'Matricula',
            doc_url: 'http://url.com',
            uploaded_by_user_id: 2
        });

        const docs = await docsRepo.findByNegotiationId(negId);
        expect(docs).toHaveLength(1);
        expect(docs[0].doc_name).toBe('Matricula');
        expect(docs[0].status).toBe('PENDING_REVIEW');
    });

});
