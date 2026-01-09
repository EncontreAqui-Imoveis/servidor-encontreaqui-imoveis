import { RowDataPacket } from 'mysql2';
import connection from '../database/connection';

type RelatedEntityType =
  | 'property'
  | 'broker'
  | 'agency'
  | 'user'
  | 'announcement'
  | 'other';

interface AdminRow {
  id: number;
}

const RELATED_ENTITY_TYPES: Set<RelatedEntityType> = new Set([
  'property',
  'broker',
  'agency',
  'user',
  'announcement',
  'other',
]);

function isValidRelatedEntityType(
  value: string
): value is RelatedEntityType {
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

  const [rows] = await connection.query<RowDataPacket[]>(
    'SELECT id FROM admins'
  );
  const adminIds = (rows as unknown as AdminRow[]).map((row) => row.id);

  if (adminIds.length === 0) {
    return;
  }

  const values = adminIds.map((adminId) => [
    message,
    relatedEntityType,
    relatedEntityId,
    adminId,
    'admin',
    'admin',
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
    [values]
  );
}
