import { ResultSetHeader, RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import { sendPushNotifications } from './pushNotificationService';
import {
  buildNotificationDeepLinkMetadata,
  withNotificationId,
  type NotificationDeepLinkMetadata,
  type NotificationTarget,
} from './notificationDeepLinkMetadata';

type RelatedEntityType =
  | 'property'
  | 'broker'
  | 'agency'
  | 'user'
  | 'announcement'
  | 'negotiation'
  | 'other';

interface AdminRow {
  id: number;
}

interface CreateAdminNotificationInput {
  type: RelatedEntityType;
  title: string;
  message: string;
  relatedEntityId?: number | null;
  metadata?: Record<string, unknown> | null;
  target?: NotificationTarget;
}

interface CreateUserNotificationInput {
  type: RelatedEntityType;
  title: string;
  message: string;
  recipientId: number;
  relatedEntityId?: number | null;
  metadata?: Record<string, unknown> | null;
  recipientRole?: 'client' | 'broker';
  target?: NotificationTarget;
}

export interface PersistedUserNotification {
  id: number;
  recipientId: number;
  metadata: NotificationDeepLinkMetadata;
}

const RELATED_ENTITY_TYPES: Set<RelatedEntityType> = new Set([
  'property',
  'broker',
  'agency',
  'user',
  'announcement',
  'negotiation',
  'other',
]);

function isValidRelatedEntityType(value: string): value is RelatedEntityType {
  return RELATED_ENTITY_TYPES.has(value as RelatedEntityType);
}

export async function notifyAdmins(
  message: string,
  relatedEntityType: RelatedEntityType,
  relatedEntityId: number
): Promise<void> {
  if (!isValidRelatedEntityType(relatedEntityType)) {
    throw new Error(`Invalid related entity type: ${relatedEntityType}`);
  }

  const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM admins');
  const adminIds = (rows as unknown as AdminRow[]).map((row) => row.id);

  if (adminIds.length === 0) {
    return;
  }

  await Promise.all(
    adminIds.map((adminId) =>
      persistNotification({
        title: null,
        message,
        type: relatedEntityType,
        relatedEntityId,
        metadata: null,
        recipientId: adminId,
        recipientType: 'admin',
        recipientRole: 'admin',
      })
    )
  );
}

export async function createAdminNotification({
  type,
  title,
  message,
  relatedEntityId = null,
  metadata = null,
  target,
}: CreateAdminNotificationInput): Promise<void> {
  if (!isValidRelatedEntityType(type)) {
    throw new Error(`Invalid related entity type: ${type}`);
  }

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  if (!trimmedTitle || !trimmedMessage) {
    return;
  }

  const [rows] = await connection.query<RowDataPacket[]>('SELECT id FROM admins');
  const adminIds = (rows as unknown as AdminRow[]).map((row) => row.id);

  if (adminIds.length === 0) {
    return;
  }

  const normalizedEntityId =
    relatedEntityId != null && Number.isFinite(relatedEntityId)
      ? Number(relatedEntityId)
      : null;
  await Promise.all(
    adminIds.map((adminId) =>
      persistNotification({
        title: trimmedTitle,
        message: trimmedMessage,
        type,
        relatedEntityId: normalizedEntityId,
        metadata,
        target,
        recipientId: adminId,
        recipientType: 'admin',
        recipientRole: 'admin',
      })
    )
  );
}

async function resolveRecipientRole(recipientId: number): Promise<'client' | 'broker'> {
  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT status FROM brokers WHERE id = ? LIMIT 1",
    [recipientId]
  );
  if (!rows || rows.length === 0) {
    return 'client';
  }
  const status = String(rows[0].status ?? '').trim();
  if (status === 'pending_verification' || status === 'approved') {
    return 'broker';
  }
  return 'client';
}

export async function createUserNotification({
  type,
  title,
  message,
  recipientId,
  relatedEntityId = null,
  metadata = null,
  recipientRole,
  target,
}: CreateUserNotificationInput): Promise<void> {
  if (!isValidRelatedEntityType(type)) {
    throw new Error(`Invalid related entity type: ${type}`);
  }

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  if (!trimmedTitle || !trimmedMessage) {
    return;
  }

  const numericRecipientId = Number(recipientId);
  if (!Number.isFinite(numericRecipientId)) {
    return;
  }

  const normalizedEntityId =
    relatedEntityId != null && Number.isFinite(relatedEntityId)
      ? Number(relatedEntityId)
      : null;
  const resolvedRole = recipientRole ?? (await resolveRecipientRole(numericRecipientId));
  const persisted = await persistUserNotification({
    type,
    title: trimmedTitle,
    message: trimmedMessage,
    recipientId: numericRecipientId,
    relatedEntityId: normalizedEntityId,
    metadata,
    recipientRole: resolvedRole,
    target,
  });
  try {
    const pushSummary = await sendPushNotifications({
      message: trimmedMessage,
      recipients: [{ recipientId: numericRecipientId, metadata: persisted.metadata }],
      title: trimmedTitle,
    });
    console.info('create_user_notification_push_dispatched', {
      recipientId: numericRecipientId,
      recipientRole: resolvedRole,
      relatedEntityType: type,
      relatedEntityId: normalizedEntityId,
      requested: pushSummary.requested,
      success: pushSummary.success,
      failure: pushSummary.failure,
      errorCodes: pushSummary.errorCodes,
    });
  } catch (pushError) {
    console.error('Falha ao enviar push em createUserNotification:', {
      recipientId: numericRecipientId,
      relatedEntityType: type,
      relatedEntityId: normalizedEntityId,
      error: pushError,
    });
  }
}

export async function persistUserNotification(input: {
  type: RelatedEntityType;
  title: string;
  message: string;
  recipientId: number;
  relatedEntityId?: number | null;
  metadata?: Record<string, unknown> | null;
  recipientRole: 'client' | 'broker';
  target?: NotificationTarget;
}): Promise<PersistedUserNotification> {
  const persisted = await persistNotification({
    ...input,
    relatedEntityId: input.relatedEntityId ?? null,
    metadata: input.metadata ?? null,
    recipientType: 'user',
  });
  return {
    id: persisted.id,
    recipientId: input.recipientId,
    metadata: persisted.metadata,
  };
}

async function persistNotification(input: {
  title: string | null;
  message: string;
  type: RelatedEntityType;
  relatedEntityId: number | null;
  metadata: Record<string, unknown> | null;
  target?: NotificationTarget;
  recipientId: number;
  recipientType: 'user' | 'admin';
  recipientRole: 'client' | 'broker' | 'admin';
}): Promise<{ id: number; metadata: NotificationDeepLinkMetadata }> {
  const metadata = buildNotificationDeepLinkMetadata({
    target: input.target,
    metadata: input.metadata,
    relatedEntityType: input.type,
    relatedEntityId: input.relatedEntityId,
  });
  const [result] = await connection.query<ResultSetHeader>(
    `
      INSERT INTO notifications (
        title,
        message,
        related_entity_type,
        related_entity_id,
        metadata_json,
        recipient_id,
        recipient_type,
        recipient_role
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      input.title,
      input.message,
      input.type,
      input.relatedEntityId,
      JSON.stringify(metadata),
      input.recipientId,
      input.recipientType,
      input.recipientRole,
    ]
  );
  const notificationId = Number(result.insertId);
  const persistedMetadata = withNotificationId(metadata, notificationId);
  await connection.query(
    'UPDATE notifications SET metadata_json = ? WHERE id = ?',
    [JSON.stringify(persistedMetadata), notificationId]
  );
  return { id: notificationId, metadata: persistedMetadata };
}
