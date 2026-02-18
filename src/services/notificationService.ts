import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';

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

  const values = adminIds.map((adminId) => [
    null,
    message,
    relatedEntityType,
    relatedEntityId,
    null,
    adminId,
    'admin',
    'admin',
  ]);

  await insertNotifications(values);
}

export async function createAdminNotification({
  type,
  title,
  message,
  relatedEntityId = null,
  metadata = null,
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
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  const values = adminIds.map((adminId) => [
    trimmedTitle,
    trimmedMessage,
    type,
    normalizedEntityId,
    metadataJson,
    adminId,
    'admin',
    'admin',
  ]);

  await insertNotifications(values);
}

async function insertNotifications(values: Array<Array<unknown>>): Promise<void> {
  try {
    await connection.query(
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
        )
        VALUES ?
      `,
      [values]
    );
  } catch (error: any) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR') {
      throw error;
    }

    const fallbackValues = values.map((row) => [
      row[1],
      row[2],
      row[3],
      row[5],
      row[6],
      row[7],
    ]);
    await connection.query(
      `
        INSERT INTO notifications (
          message,
          related_entity_type,
          related_entity_id,
          recipient_id,
          recipient_type,
          recipient_role
        )
        VALUES ?
      `,
      [fallbackValues]
    );
  }
}
