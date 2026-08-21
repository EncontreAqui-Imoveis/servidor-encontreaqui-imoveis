import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { compareMock, queryMock, signUserTokenMock, verifyIdTokenMock, withTimeoutMock } =
  vi.hoisted(() => ({
    compareMock: vi.fn(),
    queryMock: vi.fn(),
    signUserTokenMock: vi.fn(),
    verifyIdTokenMock: vi.fn(),
    withTimeoutMock: vi.fn(),
  }));

vi.mock('../../src/services/authPersistenceService', () => ({
  __esModule: true,
  authDb: {
    query: queryMock,
  },
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: compareMock,
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    auth: () => ({
      verifyIdToken: verifyIdTokenMock,
    }),
  },
}));

vi.mock('../../src/services/authSessionService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/authSessionService')>(
    '../../src/services/authSessionService',
  );

  return {
    ...actual,
    signUserToken: signUserTokenMock,
    withTimeout: withTimeoutMock,
  };
});

beforeAll(() => {
  process.env.JWT_SECRET = 'test-auth-session-operations-secret';
  process.env.NODE_ENV = 'test';
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  compareMock.mockResolvedValue(true);
  signUserTokenMock.mockReturnValue('jwt-test-token');
  withTimeoutMock.mockImplementation((promise: Promise<unknown>) => promise);
  verifyIdTokenMock.mockResolvedValue({
    uid: 'google-uid-1',
    email: 'google.user@test.com',
    name: 'Google User',
    email_verified: true,
  });
});

function mockUserSchema({
  hasCpf = true,
  hasCpfCiphertext = true,
  hasFirebaseUid = true,
  hasBrokerDocumentsStatus = true,
}: {
  hasCpf?: boolean;
  hasCpfCiphertext?: boolean;
  hasFirebaseUid?: boolean;
  hasBrokerDocumentsStatus?: boolean;
} = {}) {
  queryMock.mockResolvedValueOnce(hasCpf ? [[{}]] : [[]]);
  queryMock.mockResolvedValueOnce(hasCpfCiphertext ? [[{}]] : [[]]);
  queryMock.mockResolvedValueOnce(hasFirebaseUid ? [[{}]] : [[]]);
  queryMock.mockResolvedValueOnce(hasBrokerDocumentsStatus ? [[{}]] : [[]]);
}

describe('authSessionOperationsService', () => {
  it('authenticates login and returns session payload', async () => {
    mockUserSchema();
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 10,
          name: 'Cliente Teste',
          email: 'cliente@test.com',
          email_verified_at: null,
          password_hash: 'hash',
          phone: '62999998888',
          street: 'Rua A',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '75900000',
          token_version: 2,
          role: 'client',
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          creci: null,
          broker_documents_status: null,
        },
      ],
    ]);

    const { login } = await import('../../src/services/authSessionOperationsService');
    const result = await login({ email: 'cliente@test.com', password: 'Senha123' });

    expect(result).toMatchObject({
      token: 'jwt-test-token',
      needsCompletion: false,
      requiresDocuments: false,
      user: {
        id: 10,
        email: 'cliente@test.com',
        role: 'client',
      },
    });
    expect(signUserTokenMock).toHaveBeenCalledWith(10, 'client', 2);
  });

  it('rejects login with invalid credentials', async () => {
    mockUserSchema();
    queryMock.mockResolvedValueOnce([[]]);

    const { login } = await import('../../src/services/authSessionOperationsService');

    await expect(login({ email: 'invalido@test.com', password: 'Senha123' })).rejects.toThrow(
      'Credenciais inválidas.',
    );
    expect(compareMock).not.toHaveBeenCalled();
  });

  it('authenticates clients when the legacy broker documents table is absent', async () => {
    mockUserSchema({ hasBrokerDocumentsStatus: false });
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 11,
          name: 'Cliente Sem Documentos de Corretor',
          email: 'cliente-legado@test.com',
          email_verified_at: null,
          password_hash: 'hash',
          phone: '62999998888',
          street: 'Rua A',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '75900000',
          token_version: 2,
          role: 'client',
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          creci: null,
          broker_documents_status: null,
        },
      ],
    ]);

    const { login } = await import('../../src/services/authSessionOperationsService');
    const result = await login({ email: 'cliente-legado@test.com', password: 'Senha123' });

    expect(result.user.role).toBe('client');
    expect(queryMock.mock.calls[3]?.[0]).not.toContain('broker_documents bd');
  });

  it('returns new-user handshake for google login without existing account', async () => {
    mockUserSchema();
    queryMock.mockResolvedValueOnce([[]]);

    const { google } = await import('../../src/services/authSessionOperationsService');
    const result = await google({ idToken: 'token-google', profileType: 'broker' });

    expect(result).toMatchObject({
      isNewUser: true,
      requiresProfileChoice: true,
      pending: {
        email: 'google.user@test.com',
        name: 'Google User',
        googleUid: 'google-uid-1',
      },
      roleLocked: false,
      needsCompletion: true,
      requiresDocuments: false,
    });
  });

  it('returns authenticated payload for existing google user', async () => {
    mockUserSchema();
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 42,
          name: 'Google User',
          email: 'google.user@test.com',
          email_verified_at: new Date().toISOString(),
          phone: '62999998888',
          street: 'Rua B',
          number: '200',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '75900000',
          firebase_uid: 'google-uid-1',
          token_version: 3,
          broker_id: 42,
          broker_status: 'approved',
          broker_profile_type: 'BROKER',
          creci: '1234567',
          broker_documents_status: 'approved',
        },
      ],
    ]);

    const { google } = await import('../../src/services/authSessionOperationsService');
    const result = await google({ idToken: 'token-google', profileType: 'client' });

    expect(result).toMatchObject({
      token: 'jwt-test-token',
      needsCompletion: false,
      requiresDocuments: false,
      blockedBrokerRequest: false,
      roleLocked: true,
      isNewUser: false,
      requestedProfile: 'client',
      user: {
        id: 42,
        email: 'google.user@test.com',
        role: 'broker',
      },
    });
    expect(signUserTokenMock).toHaveBeenCalledWith(42, 'broker', 3);
  });

  it('returns an unauthorized error when Firebase rejects the ID token', async () => {
    verifyIdTokenMock.mockRejectedValueOnce({ code: 'auth/id-token-expired' });

    const { google } = await import('../../src/services/authSessionOperationsService');

    await expect(google({ idToken: 'expired-google-token' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      details: {
        code: 'GOOGLE_TOKEN_INVALID',
        retryable: false,
      },
    });
  });

  it('reports a database failure as temporarily unavailable', async () => {
    mockUserSchema();
    queryMock.mockRejectedValueOnce({
      code: 'ER_BAD_FIELD_ERROR',
      errno: 1054,
      sqlState: '42S22',
    });

    const { google } = await import('../../src/services/authSessionOperationsService');

    await expect(google({ idToken: 'google-token', requestId: 'request-google-db' })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      details: {
        code: 'AUTH_STORAGE_UNAVAILABLE',
        retryable: true,
      },
    });
  });

  it('rejects logout without authenticated user and handles missing rows', async () => {
    const { logout } = await import('../../src/services/authSessionOperationsService');

    await expect(logout({ userId: 0 })).rejects.toThrow('Usuário não autenticado.');

    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(logout({ userId: 9 })).rejects.toThrow('Usuário não encontrado.');
  });

  it('treats ER_BAD_FIELD_ERROR as successful logout', async () => {
    queryMock.mockRejectedValueOnce({ code: 'ER_BAD_FIELD_ERROR' });

    const { logout } = await import('../../src/services/authSessionOperationsService');
    const result = await logout({ userId: 9 });

    expect(result).toEqual({ message: 'Logout realizado com sucesso.' });
  });
});
