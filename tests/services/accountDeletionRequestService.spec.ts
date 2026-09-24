import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  compareMock,
  getConnectionMock,
  queryMock,
  verifyIdTokenMock,
  withTimeoutMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };
  return {
    compareMock: vi.fn(),
    getConnectionMock: vi.fn(),
    queryMock: vi.fn(),
    verifyIdTokenMock: vi.fn(),
    withTimeoutMock: vi.fn(),
    txMock: tx,
  };
});

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    getConnection: getConnectionMock,
    query: queryMock,
  },
}));

vi.mock('bcryptjs', () => ({
  default: { compare: compareMock },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    auth: () => ({ verifyIdToken: verifyIdTokenMock }),
  },
}));

vi.mock('../../src/services/authSessionService', () => ({
  withTimeout: withTimeoutMock,
}));

const now = new Date('2026-09-23T12:00:00.000Z');
const scheduledFor = new Date('2026-10-23T12:00:00.000Z');

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    email: 'user@example.com',
    password_hash: 'password-hash',
    firebase_uid: 'firebase-uid-42',
    deletion_requested_at: null,
    ...overrides,
  };
}

function arrangeTransaction(input: {
  user?: Record<string, unknown>;
  privacyRequest?: Record<string, unknown> | null;
} = {}) {
  const user = input.user ?? account();
  const privacyRequest = input.privacyRequest ?? null;
  txMock.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
      return [[user]];
    }
    if (sql.includes('FROM privacy_requests') && sql.includes('FOR UPDATE')) {
      return [privacyRequest ? [privacyRequest] : []];
    }
    return [{ affectedRows: 1 }];
  });
}

describe('startAccountDeletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    compareMock.mockResolvedValue(true);
    withTimeoutMock.mockImplementation((promise: Promise<unknown>) => promise);
    arrangeTransaction();
  });

  it('confirma senha, agenda em 30 dias, revoga acesso local e remove credenciais temporárias', async () => {
    const { startAccountDeletion } = await import('../../src/services/accountDeletionRequestService');

    const result = await startAccountDeletion({
      userId: 42,
      currentPassword: 'SenhaAtual123',
      now,
    });

    expect(result).toMatchObject({ status: 'IN_REVIEW', scheduledFor: scheduledFor.toISOString() });
    expect(compareMock).toHaveBeenCalledWith('SenhaAtual123', 'password-hash');
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO privacy_requests"),
      [expect.any(String), 42, scheduledFor, now],
    );
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('SET deletion_requested_at = ?'),
      [now, 42],
    );
    expect(txMock.query.mock.calls.some(([sql]) =>
      String(sql).includes('token_version = COALESCE(token_version, 1) + 1'),
    )).toBe(true);
    expect(txMock.query).toHaveBeenCalledWith('DELETE FROM user_device_tokens WHERE user_id = ?', [42]);
    expect(txMock.query).toHaveBeenCalledWith('DELETE FROM password_reset_tokens WHERE user_id = ?', [42]);
    expect(txMock.query).toHaveBeenCalledWith(
      'DELETE FROM email_code_challenges WHERE user_id = ? OR email = ?',
      [42, 'user@example.com'],
    );
    expect(txMock.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE registration_phone_otps'),
      [42],
    );
    expect(txMock.commit).toHaveBeenCalledOnce();
    expect(txMock.rollback).not.toHaveBeenCalled();
  });

  it('rejeita senha incorreta sem gravar solicitação ou revogar sessões', async () => {
    compareMock.mockResolvedValueOnce(false);
    const { startAccountDeletion } = await import('../../src/services/accountDeletionRequestService');

    await expect(startAccountDeletion({
      userId: 42,
      currentPassword: 'SenhaErrada',
      now,
    })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { code: 'ACCOUNT_DELETION_REAUTH_INVALID', retryable: false },
    });
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO privacy_requests'))).toBe(false);
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users'))).toBe(false);
    expect(txMock.rollback).toHaveBeenCalledOnce();
  });

  it('aceita token Firebase recente da mesma identidade', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'firebase-uid-42',
      auth_time: Math.floor(now.getTime() / 1000),
    });
    const { startAccountDeletion } = await import('../../src/services/accountDeletionRequestService');

    await expect(startAccountDeletion({
      userId: 42,
      firebaseIdToken: 'fresh-firebase-token',
      now,
    })).resolves.toMatchObject({ status: 'IN_REVIEW', scheduledFor: scheduledFor.toISOString() });
    expect(withTimeoutMock).toHaveBeenCalledOnce();
    expect(compareMock).not.toHaveBeenCalled();
  });

  it('rejeita token Firebase de outra identidade sem gravar alteração', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'other-firebase-uid',
      auth_time: Math.floor(now.getTime() / 1000),
    });
    const { startAccountDeletion } = await import('../../src/services/accountDeletionRequestService');

    await expect(startAccountDeletion({
      userId: 42,
      firebaseIdToken: 'other-firebase-token',
      now,
    })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: { code: 'ACCOUNT_DELETION_IDENTITY_MISMATCH', retryable: false },
    });
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users'))).toBe(false);
    expect(txMock.rollback).toHaveBeenCalledOnce();
  });

  it('reutiliza solicitação pendente sem incrementar token_version novamente', async () => {
    arrangeTransaction({
      user: account({ deletion_requested_at: new Date('2026-09-22T10:00:00.000Z') }),
      privacyRequest: {
        id: 'deletion-request-1',
        status: 'IN_REVIEW',
        scheduled_for: scheduledFor,
        access_revoked_at: now,
      },
    });
    const { startAccountDeletion } = await import('../../src/services/accountDeletionRequestService');

    const result = await startAccountDeletion({
      userId: 42,
      currentPassword: 'SenhaAtual123',
      now,
    });

    expect(result).toEqual({
      requestId: 'deletion-request-1',
      status: 'IN_REVIEW',
      scheduledFor: scheduledFor.toISOString(),
    });
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE users'))).toBe(false);
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM user_device_tokens'))).toBe(false);
    expect(txMock.commit).toHaveBeenCalledOnce();
  });
});
