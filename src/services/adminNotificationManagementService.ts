import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { adminDb } from './adminPersistenceService';

type NotificationTypeFilter =
  | 'property'
  | 'broker'
  | 'agency'
  | 'user'
  | 'announcement'
  | 'negotiation'
  | 'other'
  | null;

export type AdminNotificationsPayload = {
  data: RowDataPacket[];
  total: number;
  page: number;
  limit: number;
};

function parsePage(value: unknown, defaultValue: number): number {
  return Math.max(parseInt(String(value ?? defaultValue), 10) || defaultValue, 1);
}

function parseLimit(value: unknown, defaultValue: number): number {
  return Math.min(Math.max(parseInt(String(value ?? defaultValue), 10) || defaultValue, 1), 100);
}

function normalizeType(value: unknown): NotificationTypeFilter {
  const raw = String(value ?? '').trim();
  const allowedTypes = new Set([
    'property',
    'broker',
    'agency',
    'user',
    'announcement',
    'negotiation',
    'other',
  ]);
  return allowedTypes.has(raw) ? (raw as NotificationTypeFilter) : null;
}

export async function getNotifications(params: {
  adminId: number;
  page?: unknown;
  limit?: unknown;
  type?: unknown;
}): Promise<AdminNotificationsPayload> {
  const page = parsePage(params.page, 1);
  const limit = parseLimit(params.limit, 20);
  const offset = (page - 1) * limit;
  const typeFilter = normalizeType(params.type);

  const baseParams: Array<number | string> = [params.adminId];
  let typeClause = '';
  if (typeFilter) {
    typeClause = ' AND related_entity_type = ?';
    baseParams.push(typeFilter);
  }

  const [rows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT
        id,
        title,
        message,
        related_entity_type,
        related_entity_id,
        metadata_json,
        is_read,
        created_at
      FROM notifications
      WHERE recipient_id = ?
        AND recipient_type = 'admin'
        ${typeClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    [...baseParams, limit, offset],
  );

  const [countRows] = await adminDb.query<RowDataPacket[]>(
    `
      SELECT COUNT(*) as total
      FROM notifications
      WHERE recipient_id = ?
        AND recipient_type = 'admin'
        ${typeClause}
    `,
    baseParams,
  );

  const total = countRows.length > 0 ? Number(countRows[0].total) : 0;
  return { data: rows, total, page, limit };
}

export async function deleteNotification(params: {
  adminId: number;
  notificationId: number;
}): Promise<boolean> {
  const [result] = await adminDb.query<ResultSetHeader>(
    "DELETE FROM notifications WHERE id = ? AND recipient_id = ? AND recipient_type = 'admin'",
    [params.notificationId, params.adminId],
  );
  return result.affectedRows > 0;
}

export async function clearNotifications(adminId: number): Promise<void> {
  await adminDb.query(
    "DELETE FROM notifications WHERE recipient_id = ? AND recipient_type = 'admin'",
    [adminId],
  );
}

export async function clearAnnouncementNotifications(adminId: number): Promise<void> {
  await adminDb.query(
    `
      DELETE FROM notifications
      WHERE recipient_id = ?
        AND recipient_type = 'admin'
        AND related_entity_type = 'announcement'
    `,
    [adminId],
  );
}
