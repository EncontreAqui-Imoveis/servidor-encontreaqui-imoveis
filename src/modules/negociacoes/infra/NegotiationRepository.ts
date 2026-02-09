import { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { RowDataPacket } from 'mysql2';
import connection from '../../../database/connection';
import { NegotiationStatus } from '../domain/types';
import { NegotiationRow } from './types';

export class NegotiationRepository {
  constructor(private readonly db: PoolConnection | typeof connection = connection) {}

  async create(input: {
    propertyId: number;
    captadorUserId: number;
    sellerBrokerUserId: number;
    createdByUserId: number;
  }): Promise<number> {
    const [result] = await this.db.query<ResultSetHeader>(
      `
        INSERT INTO negotiations (
          property_id,
          captador_user_id,
          seller_broker_user_id,
          status,
          active,
          created_by_user_id,
          last_activity_at
        ) VALUES (?, ?, ?, 'DRAFT', 0, ?, NOW())
      `,
      [
        input.propertyId,
        input.captadorUserId,
        input.sellerBrokerUserId,
        input.createdByUserId,
      ]
    );

    return result.insertId;
  }

  async findById(id: number): Promise<NegotiationRow | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM negotiations WHERE id = ? LIMIT 1',
      [id]
    );
    return (rows[0] as NegotiationRow) ?? null;
  }

  async findActiveByPropertyId(propertyId: number): Promise<NegotiationRow | null> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM negotiations WHERE property_id = ? AND active = 1 LIMIT 1',
      [propertyId]
    );
    return (rows[0] as NegotiationRow) ?? null;
  }

  async lockActiveByPropertyId(propertyId: number): Promise<NegotiationRow[]> {
    const [rows] = await this.db.query<RowDataPacket[]>(
      'SELECT * FROM negotiations WHERE property_id = ? AND active = 1 FOR UPDATE',
      [propertyId]
    );
    return rows as NegotiationRow[];
  }

  async updateStatus(input: {
    id: number;
    status: NegotiationStatus;
    active?: number;
    startedAt?: Date | null;
    expiresAt?: Date | null;
    lastActivityAt?: Date | null;
  }): Promise<void> {
    await this.db.query(
      `
        UPDATE negotiations
        SET
          status = ?,
          active = COALESCE(?, active),
          started_at = COALESCE(?, started_at),
          expires_at = COALESCE(?, expires_at),
          last_activity_at = COALESCE(?, NOW()),
          updated_at = NOW()
        WHERE id = ?
      `,
      [
        input.status,
        input.active ?? null,
        input.startedAt ?? null,
        input.expiresAt ?? null,
        input.lastActivityAt ?? null,
        input.id,
      ]
    );
  }

  async touch(id: number): Promise<void> {
    await this.db.query(
      'UPDATE negotiations SET last_activity_at = NOW(), updated_at = NOW() WHERE id = ?',
      [id]
    );
  }

  async findPropertyById(propertyId: number): Promise<{
    id: number;
    status: string;
    visibility: string | null;
    lifecycle_status: string | null;
    broker_id: number | null;
    owner_id: number | null;
  } | null> {
    const [rows] = await this.db.query<({
      id: number;
      status: string;
      visibility: string | null;
      lifecycle_status: string | null;
      broker_id: number | null;
      owner_id: number | null;
    } & RowDataPacket)[]>(
      'SELECT id, status, visibility, lifecycle_status, broker_id, owner_id FROM properties WHERE id = ? LIMIT 1',
      [propertyId]
    );
    return rows[0] ?? null;
  }

  async updatePropertyVisibility(propertyId: number, visibility: 'PUBLIC' | 'HIDDEN'): Promise<void> {
    await this.db.query(
      'UPDATE properties SET visibility = ?, updated_at = NOW() WHERE id = ?',
      [visibility, propertyId]
    );
  }

  async updatePropertyLifecycle(propertyId: number, lifecycleStatus: 'AVAILABLE' | 'SOLD' | 'RENTED'): Promise<void> {
    await this.db.query(
      'UPDATE properties SET lifecycle_status = ?, updated_at = NOW() WHERE id = ?',
      [lifecycleStatus, propertyId]
    );
  }

  async isApprovedBroker(userId: number): Promise<boolean> {
    const [rows] = await this.db.query<({ id: number } & RowDataPacket)[]>(
      'SELECT id FROM brokers WHERE id = ? AND status = ? LIMIT 1',
      [userId, 'approved']
    );
    return rows.length > 0;
  }
}
