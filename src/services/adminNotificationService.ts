import { RowDataPacket } from 'mysql2';
import { adminDb } from './adminPersistenceService';
import { notifyUsers, splitRecipientsByRole } from './userNotificationService';
import type { PushNotificationResult } from './pushNotificationService';

type AdminNotificationEntityType =
  | 'property'
  | 'broker'
  | 'agency'
  | 'user'
  | 'announcement'
  | 'negotiation'
  | 'other';

type AdminNotificationAudience = 'all' | 'client' | 'broker' | 'favorites';

export type AdminNotificationRequestBody = {
  message?: unknown;
  recipientId?: unknown;
  recipientIds?: unknown;
  related_entity_type?: unknown;
  related_entity_id?: unknown;
  audience?: unknown;
  pushAction?: unknown;
  title?: unknown;
};

export type AdminNotificationResponse = {
  statusCode: number;
  body: {
    message?: string;
    error?: string;
    push?: PushNotificationResult;
  };
};

function normalizeEntityType(value: unknown): AdminNotificationEntityType {
  const allowedTypes = new Set<AdminNotificationEntityType>([
    'property',
    'broker',
    'agency',
    'user',
    'announcement',
    'negotiation',
    'other',
  ]);
  const rawEntityType = String(value);
  return (allowedTypes.has(rawEntityType as AdminNotificationEntityType)
    ? rawEntityType
    : 'other') as AdminNotificationEntityType;
}

function normalizeAudience(value: unknown): AdminNotificationAudience {
  const audienceValue = typeof value === 'string' ? value.trim().toLowerCase() : 'all';
  if (audienceValue === 'client' || audienceValue === 'broker' || audienceValue === 'favorites') {
    return audienceValue;
  }
  return 'all';
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRecipients(recipientId: unknown, recipientIds: unknown): Array<number | null> {
  const normalizedRecipients: Array<number | null> = [];

  if (Array.isArray(recipientIds)) {
    for (const rid of recipientIds) {
      const parsed = rid === null || rid === 'all' ? null : Number(rid);
      if (parsed === null || Number.isFinite(parsed)) {
        normalizedRecipients.push(parsed === null ? null : Number(parsed));
      }
    }
  } else if (recipientId !== undefined) {
    const parsed = recipientId === null || recipientId === 'all' ? null : Number(recipientId);
    if (parsed === null || Number.isFinite(parsed)) {
      normalizedRecipients.push(parsed === null ? null : Number(parsed));
    }
  }

  if (normalizedRecipients.length === 0) {
    normalizedRecipients.push(null);
  }

  return normalizedRecipients;
}

async function resolveNotificationRecipients(
  audience: AdminNotificationAudience,
  entityType: AdminNotificationEntityType,
  entityId: number | null,
  normalizedRecipients: Array<number | null>,
): Promise<number[]> {
  const sendToAll = normalizedRecipients.some((rid) => rid === null);

  if (audience === 'favorites') {
    if (entityType !== 'property' || entityId == null) {
      throw new Error(
        "Para público 'favoritos', informe related_entity_type='property' e related_entity_id válido.",
      );
    }

    const [favoriteRows] = await adminDb.query<RowDataPacket[]>(
      'SELECT DISTINCT usuario_id FROM favoritos WHERE imovel_id = ?',
      [entityId],
    );
    const favoriteIds = (favoriteRows ?? [])
      .map((row) => Number(row.usuario_id))
      .filter((id) => Number.isFinite(id));
    const favoriteIdSet = new Set(favoriteIds);

    if (sendToAll) {
      return favoriteIds;
    }

    return normalizedRecipients
      .filter((rid): rid is number => typeof rid === 'number')
      .filter((rid) => favoriteIdSet.has(rid));
  }

  if (sendToAll) {
    if (audience === 'broker') {
      const [userRows] = await adminDb.query<RowDataPacket[]>(
        "SELECT id FROM brokers WHERE status IN ('pending_verification','approved')",
      );
      return (userRows ?? [])
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id));
    }

    if (audience === 'client') {
      const [userRows] = await adminDb.query<RowDataPacket[]>(
        `
          SELECT u.id
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          WHERE b.id IS NULL OR b.status IN ('rejected')
        `,
      );
      return (userRows ?? [])
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id));
    }

    const [userRows] = await adminDb.query<RowDataPacket[]>('SELECT id FROM users');
    return (userRows ?? [])
      .map((row) => Number(row.id))
      .filter((id) => Number.isFinite(id));
  }

  return normalizedRecipients.filter((rid): rid is number => typeof rid === 'number');
}

export async function sendAdminNotification(
  body: AdminNotificationRequestBody,
): Promise<AdminNotificationResponse> {
  const message = body.message;
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return {
      statusCode: 400,
      body: { error: 'A mensagem e obrigatoria.' },
    };
  }

  const trimmedMessage = message.trim();
  const entityType = normalizeEntityType(body.related_entity_type);
  const entityId = body.related_entity_id != null ? Number(body.related_entity_id) : null;
  const audience = normalizeAudience(body.audience);
  const normalizedRecipients = normalizeRecipients(body.recipientId, body.recipientIds);
  const numericEntityId = entityId != null && Number.isFinite(entityId) ? Number(entityId) : null;

  let notificationRecipients: number[];
  try {
    notificationRecipients = await resolveNotificationRecipients(
      audience,
      entityType,
      numericEntityId,
      normalizedRecipients,
    );
  } catch (error) {
    return {
      statusCode: 400,
      body: { error: error instanceof Error ? error.message : 'Requisição inválida.' },
    };
  }

  if (notificationRecipients.length === 0) {
    return {
      statusCode: 200,
      body: {
        message: 'Nenhum destinatário encontrado para envio.',
        push: { requested: 0, success: 0, failure: 0, errorCodes: [] },
      },
    };
  }

  const { clientIds, brokerIds } = await splitRecipientsByRole(notificationRecipients);
  const targetClientIds = audience === 'broker' ? [] : clientIds;
  const targetBrokerIds = audience === 'client' ? [] : brokerIds;

  const summaries: PushNotificationResult[] = [];
  console.info('admin_notification_dispatch_started', {
    audience,
    sendToAll: normalizedRecipients.some((rid) => rid === null),
    requestedRecipients: notificationRecipients.length,
    relatedEntityType: entityType,
    relatedEntityId: numericEntityId,
  });

  if (targetClientIds.length > 0) {
    const summary = await notifyUsers({
      message: trimmedMessage,
      recipientIds: targetClientIds,
      recipientRole: 'client',
      relatedEntityType: entityType,
      relatedEntityId: numericEntityId,
      pushAction: normalizeOptionalText(body.pushAction),
      title: normalizeOptionalText(body.title),
    });
    if (summary) {
      summaries.push(summary);
    }
  }

  if (targetBrokerIds.length > 0) {
    const summary = await notifyUsers({
      message: trimmedMessage,
      recipientIds: targetBrokerIds,
      recipientRole: 'broker',
      relatedEntityType: entityType,
      relatedEntityId: numericEntityId,
      pushAction: normalizeOptionalText(body.pushAction),
      title: normalizeOptionalText(body.title),
    });
    if (summary) {
      summaries.push(summary);
    }
  }

  if (summaries.length === 0) {
    return {
      statusCode: 200,
      body: {
        message: 'Nenhum destinatário encontrado para envio.',
        push: { requested: 0, success: 0, failure: 0, errorCodes: [] },
      },
    };
  }

  const errorCodes = new Set<string>();
  const combined: PushNotificationResult = {
    requested: 0,
    success: 0,
    failure: 0,
    errorCodes: [],
  };

  for (const summary of summaries) {
    combined.requested += summary.requested;
    combined.success += summary.success;
    combined.failure += summary.failure;
    for (const code of summary.errorCodes) {
      errorCodes.add(code);
    }
  }

  combined.errorCodes = Array.from(errorCodes);

  console.info('admin_notification_dispatch_finished', {
    audience,
    requested: combined.requested,
    success: combined.success,
    failure: combined.failure,
    errorCodes: combined.errorCodes,
    relatedEntityType: entityType,
    relatedEntityId: numericEntityId,
  });

  return {
    statusCode: 201,
    body: {
      message: 'Notificação enviada com sucesso.',
      push: combined,
    },
  };
}
