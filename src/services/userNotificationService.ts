import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import {
  sendPushNotifications,
  type PushNotificationResult,
} from './pushNotificationService';
import {
  persistUserNotification,
  type PersistedUserNotification,
} from './notificationService';
import type { NotificationTarget } from './notificationDeepLinkMetadata';

type RelatedEntityType =
  | 'property'
  | 'broker'
  | 'agency'
  | 'user'
  | 'announcement'
  | 'negotiation'
  | 'other';
export type RecipientRole = 'client' | 'broker';

const ACTIVE_BROKER_STATUSES = new Set([
  'pending_verification',
  'approved',
]);

interface NotifyUsersInput {
  message: string;
  recipientIds: number[];
  recipientRole: RecipientRole;
  relatedEntityType: RelatedEntityType;
  relatedEntityId?: number | null;
  sendPush?: boolean;
  /** Repassado ao FCM `data.action` (ex.: `edit_rejected`). */
  pushAction?: string | null;
  /** Título da notificação. */
  title?: string | null;
  /** Destino autenticado aceito pelo aplicativo. */
  target?: NotificationTarget;
  /** Somente IDs de rota; campos não permitidos serão descartados. */
  metadata?: Record<string, unknown> | null;
}

function normalizeOutgoingMessage(input: string): string {
  const compact = String(input ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compact) return '';
  const hasTerminalPunctuation = /[.!?…]$/.test(compact);
  return hasTerminalPunctuation ? compact : `${compact}.`;
}

export async function notifyUsers({
  message,
  recipientIds,
  recipientRole,
  relatedEntityType,
  relatedEntityId = null,
  sendPush = true,
  pushAction = null,
  title = null,
  target,
  metadata = null,
}: NotifyUsersInput): Promise<PushNotificationResult | null> {
  const trimmed = normalizeOutgoingMessage(message);
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

  const persistedNotifications: PersistedUserNotification[] = [];
  console.info('notify_users_dispatch_started', {
    relatedEntityType,
    relatedEntityId,
    recipientRole,
    requestedRecipients: uniqueRecipients.length,
    sendPush,
    pushAction: pushAction ?? null,
    title: title ?? null,
  });
  for (const recipientId of uniqueRecipients) {
    persistedNotifications.push(
      await persistUserNotification({
        type: relatedEntityType,
        title: title?.trim() || 'Encontre Aqui',
        message: trimmed,
        recipientId,
        relatedEntityId,
        recipientRole,
        target,
        metadata,
      })
    );
  }

  if (!sendPush) {
    console.info('notify_users_dispatch_finished', {
      relatedEntityType,
      relatedEntityId,
      recipientRole,
      requestedRecipients: uniqueRecipients.length,
      pushRequested: 0,
      pushSuccess: 0,
      pushFailure: 0,
      errorCodes: [],
    });
    return null;
  }

  const summary = await sendPushNotifications({
    message: trimmed,
    recipients: persistedNotifications.map((notification) => ({
      recipientId: notification.recipientId,
      metadata: notification.metadata,
    })),
    title,
  });
  console.info('notify_users_dispatch_finished', {
    relatedEntityType,
    relatedEntityId,
    recipientRole,
    requestedRecipients: uniqueRecipients.length,
    pushRequested: summary.requested,
    pushSuccess: summary.success,
    pushFailure: summary.failure,
    errorCodes: summary.errorCodes,
  });
  return summary;
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
