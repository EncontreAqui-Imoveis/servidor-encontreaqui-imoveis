import { RowDataPacket } from 'mysql2';

export const DUPLICATE_ACCOUNT_NAME_CODE = 'DUPLICATE_ACCOUNT_NAME';
export const DUPLICATE_ACCOUNT_NAME_MESSAGE = 'Este nome já está em uso.';

type UserNameQueryExecutor = {
  query: (sql: string, values?: unknown[]) => Promise<[RowDataPacket[], unknown]>;
};

export class DuplicateAccountNameError extends Error {
  readonly code = DUPLICATE_ACCOUNT_NAME_CODE;
  readonly statusCode = 400;

  constructor() {
    super(DUPLICATE_ACCOUNT_NAME_MESSAGE);
    this.name = 'DuplicateAccountNameError';
  }
}

export function normalizeAccountName(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

/**
 * The current users schema has no deactivation column, so every persisted
 * account is treated as active until that lifecycle state exists explicitly.
 */
export async function assertAccountNameAvailable(
  db: UserNameQueryExecutor,
  rawName: unknown,
  excludingUserId?: unknown,
): Promise<void> {
  const normalizedName = normalizeAccountName(rawName);
  if (!normalizedName) {
    return;
  }

  const excludedId = Number(excludingUserId ?? 0);
  const [rows] = await db.query(
    `
      SELECT id
      FROM users
      WHERE LOWER(TRIM(name)) = ?
        AND (? <= 0 OR id <> ?)
      LIMIT 1
    `,
    [normalizedName, excludedId, excludedId],
  );

  if (rows.length > 0) {
    throw new DuplicateAccountNameError();
  }
}

export function isDuplicateAccountNameError(error: unknown): error is DuplicateAccountNameError {
  return error instanceof DuplicateAccountNameError;
}
