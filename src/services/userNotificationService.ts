import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import {
  sendPushNotifications,
  type PushNotificationResult,
} from './pushNotificationService';

type RelatedEntityType = 'property' | 'broker' | 'agency' | 'user' | 'other';

interface NotifyUsersInput {
  message: string;
  recipientIds: number[];
  relatedEntityType: RelatedEntityType;
  relatedEntityId?: number | null;
  sendPush?: boolean;
}

export async function notifyUsers({
  message,
  recipientIds,
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
  ]);

  const batchSize = 500;
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    await connection.query(
      `
        INSERT INTO notifications (message, related_entity_type, related_entity_id, recipient_id)
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
        AND related_entity_type = ?
        AND related_entity_id = ?
        AND message LIKE ?
        AND created_at >= ?
    `,
    [...uniqueRecipients, relatedEntityType, relatedEntityId, `${messagePrefix}%`, cutoff]
  );

  const blocked = new Set(
    (rows ?? []).map((row) => Number(row.recipient_id)).filter((id) => Number.isFinite(id))
  );

  return uniqueRecipients.filter((id) => !blocked.has(id));
}
