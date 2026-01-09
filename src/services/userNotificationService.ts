import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import {
  sendPushNotifications,
  type PushNotificationResult,
} from './pushNotificationService';

type RelatedEntityType =
  | 'property'
  | 'broker'
  | 'agency'
  | 'user'
  | 'announcement'
  | 'other';
export type RecipientRole = 'client' | 'broker';

const ACTIVE_BROKER_STATUSES = new Set(['pending_verification', 'approved']);

interface NotifyUsersInput {
  message: string;
  recipientIds: number[];
  recipientRole: RecipientRole;
  relatedEntityType: RelatedEntityType;
  relatedEntityId?: number | null;
  sendPush?: boolean;
}

export async function notifyUsers({
  message,
  recipientIds,
  recipientRole,
  relatedEntityType,
  relatedEntityId = null,
  sendPush = true,
}: NotifyUsersInput): Promise<PushNotificationResult | null> {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const uniqueRecipients = Array.from(
    new Set(
      recipientIds
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id))
    )
  );

  if (uniqueRecipients.length === 0) {
    return null;
  }

  const values = uniqueRecipients.map((rid) => [
    trimmed,
    relatedEntityType,
    relatedEntityId,
    rid,
    'user',
    recipientRole,
  ]);

  const batchSize = 500;
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    await connection.query(
      `
        INSERT INTO notifications (message, related_entity_type, related_entity_id, recipient_id, recipient_type, recipient_role)
        VALUES ?
      `,
      [chunk]
    );
  }

  if (!sendPush) {
    return null;
  }

  return sendPushNotifications({
    message: trimmed,
    recipientIds: uniqueRecipients,
    relatedEntityType,
    relatedEntityId,
  });
}

export async function filterRecipientsByCooldown(
  recipientIds: number[],
  relatedEntityType: RelatedEntityType,
  relatedEntityId: number | null,
  messagePrefix: string,
  cutoff: Date,
  recipientRole: RecipientRole,
): Promise<number[]> {
  const uniqueRecipients = Array.from(new Set(recipientIds));
  if (uniqueRecipients.length === 0) {
    return [];
  }

  const placeholders = uniqueRecipients.map(() => '?').join(', ');
  const [rows] = await connection.query<RowDataPacket[]>(
    `
      SELECT DISTINCT recipient_id
      FROM notifications
      WHERE recipient_id IN (${placeholders})
        AND recipient_type = 'user'
        AND recipient_role = ?
        AND related_entity_type = ?
        AND related_entity_id = ?
        AND message LIKE ?
        AND created_at >= ?
    `,
    [...uniqueRecipients, recipientRole, relatedEntityType, relatedEntityId, `${messagePrefix}%`, cutoff]
  );

  const blocked = new Set(
    (rows ?? []).map((row) => Number(row.recipient_id)).filter((id) => Number.isFinite(id))
  );

  return uniqueRecipients.filter((id) => !blocked.has(id));
}

export async function splitRecipientsByRole(
  recipientIds: number[],
): Promise<{ clientIds: number[]; brokerIds: number[] }> {
  const uniqueIds = Array.from(
    new Set(recipientIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))
  );

  if (uniqueIds.length === 0) {
    return { clientIds: [], brokerIds: [] };
  }

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id, status FROM brokers WHERE id IN (${placeholders})`,
    uniqueIds
  );

  const brokerIds = new Set<number>();
  for (const row of rows ?? []) {
    const brokerId = Number(row.id);
    if (!Number.isFinite(brokerId)) {
      continue;
    }
    const status = String(row.status ?? '').trim();
    if (ACTIVE_BROKER_STATUSES.has(status)) {
      brokerIds.add(brokerId);
    }
  }

  const clientIds = uniqueIds.filter((id) => !brokerIds.has(id));
  return { clientIds, brokerIds: Array.from(brokerIds) };
}

export async function resolveUserNotificationRole(userId: number): Promise<RecipientRole> {
  if (!Number.isFinite(userId)) {
    return 'client';
  }

  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT status FROM brokers WHERE id = ? LIMIT 1',
    [userId]
  );

  if (!rows || rows.length === 0) {
    return 'client';
  }

  const status = String(rows[0].status ?? '').trim();
  return ACTIVE_BROKER_STATUSES.has(status) ? 'broker' : 'client';
}
