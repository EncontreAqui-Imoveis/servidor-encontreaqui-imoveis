"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NegotiationRepository = void 0;
const db_1 = require("./db");
class NegotiationRepository {
    db;
    constructor(db = (0, db_1.getDefaultQueryRunner)()) {
        this.db = db;
    }
    async create(input) {
        const [result] = await this.db.query(`
        INSERT INTO negotiations (
          property_id,
          captador_user_id,
          seller_broker_user_id,
          status,
          active,
          created_by_user_id,
          last_activity_at
        ) VALUES (?, ?, ?, 'DRAFT', 0, ?, NOW())
      `, [
            input.propertyId,
            input.captadorUserId,
            input.sellerBrokerUserId,
            input.createdByUserId,
        ]);
        return result.insertId;
    }
    async findById(id) {
        const [rows] = await this.db.query('SELECT * FROM negotiations WHERE id = ? LIMIT 1', [id]);
        return rows[0] ?? null;
    }
    async listByStatus(status) {
        const [rows] = await this.db.query('SELECT * FROM negotiations WHERE status = ? ORDER BY created_at DESC', [status]);
        return rows;
    }
    async findActiveByPropertyId(propertyId) {
        const [rows] = await this.db.query('SELECT * FROM negotiations WHERE property_id = ? AND active = 1 LIMIT 1', [propertyId]);
        return rows[0] ?? null;
    }
    async lockActiveByPropertyId(propertyId) {
        const [rows] = await this.db.query('SELECT * FROM negotiations WHERE property_id = ? AND active = 1 FOR UPDATE', [propertyId]);
        return rows;
    }
    async updateStatus(input) {
        await this.db.query(`
        UPDATE negotiations
        SET
          status = ?,
          active = COALESCE(?, active),
          started_at = COALESCE(?, started_at),
          expires_at = COALESCE(?, expires_at),
          last_activity_at = COALESCE(?, NOW()),
          updated_at = NOW()
        WHERE id = ?
      `, [
            input.status,
            input.active ?? null,
            input.startedAt ?? null,
            input.expiresAt ?? null,
            input.lastActivityAt ?? null,
            input.id,
        ]);
    }
    async touch(id) {
        await this.db.query('UPDATE negotiations SET last_activity_at = NOW(), updated_at = NOW() WHERE id = ?', [id]);
    }
    async findPropertyById(propertyId) {
        const [rows] = await this.db.query('SELECT id, status, visibility, lifecycle_status, broker_id, owner_id FROM properties WHERE id = ? LIMIT 1', [propertyId]);
        return rows[0] ?? null;
    }
    async updatePropertyVisibility(propertyId, visibility) {
        await this.db.query('UPDATE properties SET visibility = ?, updated_at = NOW() WHERE id = ?', [visibility, propertyId]);
    }
    async updatePropertyLifecycle(propertyId, lifecycleStatus) {
        await this.db.query('UPDATE properties SET lifecycle_status = ?, updated_at = NOW() WHERE id = ?', [lifecycleStatus, propertyId]);
    }
    async isApprovedBroker(userId) {
        const [rows] = await this.db.query('SELECT id FROM brokers WHERE id = ? AND status = ? LIMIT 1', [userId, 'approved']);
        return rows.length > 0;
    }
}
exports.NegotiationRepository = NegotiationRepository;
