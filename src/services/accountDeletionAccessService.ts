import { ForbiddenError } from '../errors/ApplicationError';

export const ACCOUNT_DELETION_PENDING_CODE = 'ACCOUNT_DELETION_PENDING';

type AccountDeletionState = {
  deletion_requested_at?: unknown;
};

export function hasAccountDeletionPending(
  account: unknown,
): boolean {
  if (account == null || typeof account !== 'object') {
    return false;
  }
  const value = (account as AccountDeletionState).deletion_requested_at;
  return value != null && String(value).trim().length > 0;
}

export function assertAccountAuthenticationAllowed(
  account: unknown,
): void {
  if (hasAccountDeletionPending(account)) {
    throw new ForbiddenError('Esta conta está em processo de exclusão.', {
      code: ACCOUNT_DELETION_PENDING_CODE,
      retryable: false,
    });
  }
}
