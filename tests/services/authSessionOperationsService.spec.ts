import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApplicationError,
  UnauthorizedError,
  NotFoundError,
} from '../../src/errors/ApplicationError';

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

describe('authSessionOperationsService', () => {
  it('authenticates login and returns session payload', async () => {
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
    queryMock.mockResolvedValueOnce([[]]);

    const { login } = await import('../../src/services/authSessionOperationsService');

    await expect(login({ email: 'invalido@test.com', password: 'Senha123' })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(compareMock).not.toHaveBeenCalled();
  });

  it('returns new-user handshake for google login without existing account', async () => {
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
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 42,
          name: 'Google User',
          email: 'google.user@test.com',
          email_verified_at: null,
          phone: '62999998888',
          street: 'Rua B',
          number: '200',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '75900000',
          firebase_uid: null,
          token_version: 3,
          broker_id: 42,
          broker_status: 'approved',
          broker_profile_type: 'BROKER',
          creci: '1234567',
          broker_documents_status: 'approved',
        },
      ],
    ]);
    queryMock.mockResolvedValueOnce([[]]);
    queryMock.mockResolvedValueOnce([[]]);

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

  it('rejects logout without authenticated user and handles missing rows', async () => {
    const { logout } = await import('../../src/services/authSessionOperationsService');

    await expect(logout({ userId: 0 })).rejects.toBeInstanceOf(UnauthorizedError);

    queryMock.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(logout({ userId: 9 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats ER_BAD_FIELD_ERROR as successful logout', async () => {
    queryMock.mockRejectedValueOnce({ code: 'ER_BAD_FIELD_ERROR' });

    const { logout } = await import('../../src/services/authSessionOperationsService');
    const result = await logout({ userId: 9 });

    expect(result).toEqual({ message: 'Logout realizado com sucesso.' });
  });
});
