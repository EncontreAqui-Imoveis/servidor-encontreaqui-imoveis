import { ResultSetHeader, RowDataPacket } from 'mysql2';
import connection from '../database/connection';
import { sendPushNotifications } from './pushNotificationService';
import {
  buildNotificationDeepLinkMetadata,
  withNotificationId,
  type NotificationDeepLinkMetadata,
  type NotificationTarget,
} from './notificationDeepLinkMetadata';
import {
  hasAdminCapability,
  normalizeAdminPanelRole,
} from '../middlewares/adminCapabilities';

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

interface WorkflowAdminRow extends RowDataPacket, AdminRow {
  role?: string | null;
  is_active?: number | boolean | null;
  user_id?: number | null;
}

interface CreateAdminNotificationInput {
  type: RelatedEntityType;
  title: string;
  message: string;
  relatedEntityId?: number | null;
  metadata?: Record<string, unknown> | null;
  target?: NotificationTarget;
}

interface CreateWorkflowAdminNotificationInput extends CreateAdminNotificationInput {
  /** IDs de usuários que não podem receber a notificação administrativa. */
  excludeUserIds?: number[];
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

/**
 * Notifica somente contas administrativas ativas que podem atuar no fluxo
 * contratual. A notificação continua pertencendo à caixa administrativa; o
 * push, quando houver uma identidade de usuário vinculada pelo e-mail, reutiliza
 * exatamente a mesma notificação persistida e sua metadata canônica.
 */
export async function createWorkflowAdminNotification({
  type,
  title,
  message,
  relatedEntityId = null,
  metadata = null,
  target,
  excludeUserIds = [],
}: CreateWorkflowAdminNotificationInput): Promise<void> {
  if (!isValidRelatedEntityType(type)) {
    throw new Error(`Invalid related entity type: ${type}`);
  }

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  if (!trimmedTitle || !trimmedMessage) {
    return;
  }

  const excludedUserIds = new Set(
    excludeUserIds
      .map((id) => Number(id))
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  );
  const [rows] = await connection.query<WorkflowAdminRow[]>(
    `
      SELECT a.id, a.role, a.is_active, u.id AS user_id
      FROM admins a
      LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(a.email))
    `,
  );
  const normalizedEntityId =
    relatedEntityId != null && Number.isFinite(relatedEntityId)
      ? Number(relatedEntityId)
      : null;
  const recipientIdentityKeys = new Set<string>();
  const persistedNotifications: Array<{ recipientId: number; metadata: NotificationDeepLinkMetadata }> = [];

  for (const row of rows ?? []) {
    const adminId = Number(row.id);
    if (!Number.isSafeInteger(adminId) || adminId <= 0) continue;
    const isActive = row.is_active == null || row.is_active === true || Number(row.is_active) === 1;
    if (!isActive || !hasAdminCapability(normalizeAdminPanelRole(row.role), 'manage_contract_workflow')) {
      continue;
    }

    const linkedUserId = Number(row.user_id);
    const hasLinkedUser = Number.isSafeInteger(linkedUserId) && linkedUserId > 0;
    if (hasLinkedUser && excludedUserIds.has(linkedUserId)) {
      continue;
    }

    const identityKey = hasLinkedUser ? `user:${linkedUserId}` : `admin:${adminId}`;
    if (recipientIdentityKeys.has(identityKey)) {
      continue;
    }
    recipientIdentityKeys.add(identityKey);

    const persisted = await persistNotification({
      title: trimmedTitle,
      message: trimmedMessage,
      type,
      relatedEntityId: normalizedEntityId,
      metadata,
      target,
      recipientId: adminId,
      recipientType: 'admin',
      recipientRole: 'admin',
    });
    if (hasLinkedUser) {
      persistedNotifications.push({ recipientId: linkedUserId, metadata: persisted.metadata });
    }
  }

  if (persistedNotifications.length === 0) {
    return;
  }

  try {
    const pushSummary = await sendPushNotifications({
      message: trimmedMessage,
      recipients: persistedNotifications,
      title: trimmedTitle,
    });
    console.info('create_workflow_admin_notification_push_dispatched', {
      recipientCount: persistedNotifications.length,
      relatedEntityType: type,
      relatedEntityId: normalizedEntityId,
      requested: pushSummary.requested,
      success: pushSummary.success,
      failure: pushSummary.failure,
      errorCodes: pushSummary.errorCodes,
    });
  } catch (pushError) {
    console.error('Falha ao enviar push em createWorkflowAdminNotification:', {
      recipientCount: persistedNotifications.length,
      relatedEntityType: type,
      relatedEntityId: normalizedEntityId,
      error: pushError,
    });
  }
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
