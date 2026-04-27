import { RowDataPacket } from 'mysql2';

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<any>;
};

type LifecycleOptions = {
  forUpdate?: boolean;
};

export interface UserLifecycleSnapshot extends RowDataPacket {
  id: number;
  name: string;
  email: string;
  broker_id: number | null;
  broker_status: string | null;
}

const ACTIVE_BROKER_STATUSES = new Set(['pending_verification', 'approved']);

export function isActiveBrokerStatus(status: unknown): boolean {
  return ACTIVE_BROKER_STATUSES.has(String(status ?? '').trim());
}

export async function loadUserLifecycleSnapshot(
  db: Queryable,
  userId: number,
  options: LifecycleOptions = {},
): Promise<UserLifecycleSnapshot | null> {
  const suffix = options.forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.query(
    `
      SELECT
        u.id,
        u.name,
        u.email,
        b.id AS broker_id,
        b.status AS broker_status
      FROM users u
      LEFT JOIN brokers b ON b.id = u.id
      WHERE u.id = ?
      LIMIT 1${suffix}
    `,
    [userId],
  );

  const typedRows = rows as UserLifecycleSnapshot[];
  return typedRows.length > 0 ? typedRows[0] : null;
}

export async function revokeUserSessions(db: Queryable, userId: number): Promise<void> {
  await db.query(
    'UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
    [userId],
  );
}

async function updateBrokerStatusWithLegacyFallback(
  db: Queryable,
  brokerId: number,
  status: string
): Promise<void> {
  try {
    await db.query(
      'UPDATE brokers SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, brokerId],
    );
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
    const message = String((error as { message?: unknown })?.message ?? '');
    const isMissingUpdatedAt =
      code === 'ER_BAD_FIELD_ERROR' &&
      message.toLowerCase().includes("unknown column 'updated_at'");
    if (!isMissingUpdatedAt) {
      throw error;
    }
    await db.query('UPDATE brokers SET status = ? WHERE id = ?', [status, brokerId]);
  }
}

async function updateBrokerDocumentsStatusWithLegacyFallback(
  db: Queryable,
  brokerId: number,
  status: string
): Promise<void> {
  try {
    await db.query(
      'UPDATE broker_documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE broker_id = ?',
      [status, brokerId],
    );
  } catch (error) {
    const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
    const message = String((error as { message?: unknown })?.message ?? '');
    const isMissingUpdatedAt =
      code === 'ER_BAD_FIELD_ERROR' &&
      message.toLowerCase().includes("unknown column 'updated_at'");
    if (!isMissingUpdatedAt) {
      throw error;
    }
    await db.query('UPDATE broker_documents SET status = ? WHERE broker_id = ?', [status, brokerId]);
  }
}

export async function rejectBrokerAccount(
  db: Queryable,
  brokerId: number,
): Promise<{ snapshot: UserLifecycleSnapshot | null; affected: boolean }> {
  const snapshot = await loadUserLifecycleSnapshot(db, brokerId, { forUpdate: true });
  if (!snapshot || snapshot.broker_id == null) {
    return { snapshot, affected: false };
  }

  await updateBrokerStatusWithLegacyFallback(db, brokerId, 'rejected');
  await updateBrokerDocumentsStatusWithLegacyFallback(db, brokerId, 'rejected');
  await db.query('UPDATE properties SET broker_id = NULL WHERE broker_id = ?', [brokerId]);
  await revokeUserSessions(db, brokerId);

  return { snapshot, affected: true };
}

export async function approveBrokerAccount(
  db: Queryable,
  brokerId: number,
): Promise<{ snapshot: UserLifecycleSnapshot | null; affected: boolean }> {
  const snapshot = await loadUserLifecycleSnapshot(db, brokerId, { forUpdate: true });
  if (!snapshot || snapshot.broker_id == null) {
    return { snapshot, affected: false };
  }

  await updateBrokerStatusWithLegacyFallback(db, brokerId, 'approved');
  await updateBrokerDocumentsStatusWithLegacyFallback(db, brokerId, 'approved');

  return { snapshot, affected: true };
}

export async function deleteUserAccount(
  db: Queryable,
  userId: number,
): Promise<{ snapshot: UserLifecycleSnapshot | null; affected: boolean }> {
  const snapshot = await loadUserLifecycleSnapshot(db, userId, { forUpdate: true });
  if (!snapshot) {
    return { snapshot, affected: false };
  }

  try {
    await db.query('UPDATE negotiation_history SET actor_id = NULL WHERE actor_id = ?', [userId]);
  } catch (historyError) {
    console.warn(
      'Falha ao anonimizar actor_id em negotiation_history; removendo historico vinculado ao usuario.',
      historyError,
    );
    await db.query('DELETE FROM negotiation_history WHERE actor_id = ?', [userId]);
  }

  await db.query(
    "DELETE FROM notifications WHERE recipient_id = ? AND recipient_type = 'user'",
    [userId],
  );

  // Clean up completed registration drafts so the email can be re-used
  try {
    await db.query(
      "DELETE FROM registration_drafts WHERE user_id = ? AND status = 'COMPLETED'",
      [userId],
    );
  } catch (draftError) {
    console.warn(
      'Falha ao remover drafts COMPLETED do usuario; tentando por email.',
      draftError,
    );
    try {
      await db.query(
        "DELETE FROM registration_drafts WHERE LOWER(TRIM(email)) = LOWER(TRIM((SELECT email FROM users WHERE id = ?))) AND status = 'COMPLETED'",
        [userId],
      );
    } catch {
      /* best effort */
    }
  }

  const [result] = await db.query('DELETE FROM users WHERE id = ?', [userId]);
  return { snapshot, affected: result.affectedRows > 0 };
}
