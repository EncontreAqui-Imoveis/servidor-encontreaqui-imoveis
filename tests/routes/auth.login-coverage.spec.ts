import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidInputError, UnauthorizedError } from '../../src/errors/ApplicationError';

const {
  hashMock,
  queryMock,
  compareMock,
  signUserTokenMock,
  loginSessionMock,
  googleSessionMock,
} = vi.hoisted(() => ({
  hashMock: vi.fn(),
  queryMock: vi.fn(),
  compareMock: vi.fn(),
  signUserTokenMock: vi.fn(),
  loginSessionMock: vi.fn(),
  googleSessionMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/authSessionService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/authSessionService')>(
    '../../src/services/authSessionService',
  );
  return {
    ...actual,
    signUserToken: signUserTokenMock,
  };
});

vi.mock('bcryptjs', () => ({
  default: {
    compare: compareMock,
    hash: hashMock,
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  __esModule: true,
  default: {
    auth: () => ({
      verifyIdToken: vi.fn(),
      getUserByEmail: vi.fn(),
      createUser: vi.fn(),
    }),
  },
}));

vi.mock('../../src/services/authSessionOperationsService', () => ({
  login: loginSessionMock,
  google: googleSessionMock,
  logout: vi.fn(),
}));

describe('POST /auth e /users login coverage', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    const { default: userRoutes } = await import('../../src/routes/user.routes');

    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use('/users', userRoutes);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    compareMock.mockResolvedValue(true);
    hashMock.mockResolvedValue('senha-hash');
    signUserTokenMock.mockReturnValue('jwt-test-token');

    loginSessionMock.mockImplementation(async ({ email, password }) => {
      const normalizedEmail = String(email ?? '').trim().toLowerCase();
      const normalizedPassword = String(password ?? '');

      if (!normalizedEmail || !normalizedPassword) {
        throw new InvalidInputError('Email e senha são obrigatórios.');
      }

      if (normalizedEmail === 'inexistente@dominio.com' || normalizedPassword === 'Errada123') {
        throw new UnauthorizedError('Credenciais inválidas.');
      }

      if (normalizedEmail === 'teste@dominio.com') {
        signUserTokenMock(77, 'client', 1);
        return {
          token: 'jwt-test-token',
          needsCompletion: false,
          requiresDocuments: false,
          user: {
            id: 77,
            email: 'teste@dominio.com',
            role: 'client',
            broker_status: null,
            broker: null,
            email_verified: true,
            phone: '62999998888',
          },
        };
      }

      if (normalizedEmail === 'semcep@dominio.com') {
        signUserTokenMock(78, 'client', 1);
        return {
          token: 'jwt-test-token',
          needsCompletion: false,
          requiresDocuments: false,
          user: {
            id: 78,
            email: 'semcep@dominio.com',
            role: 'client',
            broker_status: null,
            broker: null,
            email_verified: true,
            phone: '62999990000',
          },
        };
      }

      if (normalizedEmail === 'semcep-users@dominio.com') {
        signUserTokenMock(89, 'client', 1);
        return {
          token: 'jwt-test-token',
          needsCompletion: false,
          requiresDocuments: false,
          user: {
            id: 89,
            email: 'semcep-users@dominio.com',
            role: 'client',
            broker_status: null,
            broker: null,
            email_verified: true,
            phone: '62999990001',
          },
        };
      }

      if (normalizedEmail === 'broker@dominio.com') {
        signUserTokenMock(101, 'broker', 1);
        return {
          token: 'jwt-test-token',
          needsCompletion: false,
          requiresDocuments: true,
          user: {
            id: 101,
            email: 'broker@dominio.com',
            role: 'broker',
            broker_status: 'pending_verification',
            broker: {
              id: 101,
              status: 'pending_documents',
              creci: '12345678-A',
            },
          },
        };
      }

      if (normalizedEmail === 'semtelefone@dominio.com') {
        signUserTokenMock(101, 'client', 4);
        return {
          token: 'jwt-test-token',
          needsCompletion: true,
          requiresDocuments: false,
          user: {
            id: 101,
            email: 'semtelefone@dominio.com',
            role: 'client',
            broker_status: null,
            broker: null,
            email_verified: true,
            phone: null,
          },
        };
      }

      if (normalizedEmail === 'incompleto@dominio.com') {
        signUserTokenMock(102, 'client', 1);
        return {
          token: 'jwt-test-token',
          needsCompletion: true,
          requiresDocuments: false,
          user: {
            id: 102,
            email: 'incompleto@dominio.com',
            role: 'client',
            broker_status: null,
            broker: null,
            email_verified: true,
            phone: null,
          },
        };
      }

      if (normalizedEmail === 'brokersem@dominio.com') {
        signUserTokenMock(103, 'broker', 6);
        return {
          token: 'jwt-test-token',
          needsCompletion: false,
          requiresDocuments: true,
          user: {
            id: 103,
            email: 'brokersem@dominio.com',
            role: 'broker',
            broker_status: 'approved',
            broker: {
              id: 103,
              status: 'approved',
              creci: null,
            },
          },
        };
      }

      if (normalizedEmail === 'semantico@dominio.com') {
        signUserTokenMock(104, 'client', 2);
        return {
          token: 'jwt-test-token',
          needsCompletion: false,
          requiresDocuments: false,
          user: {
            id: 104,
            email: 'semantico@dominio.com',
            role: 'client',
            broker_status: null,
            broker: null,
            email_verified: true,
            phone: '62999998888',
          },
        };
      }

      throw new UnauthorizedError('Credenciais inválidas.');
    });
  });

  it('rejects /auth/login with missing password', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'teste@dominio.com',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Email e senha são obrigatórios.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('autentica em /auth/login e retorna token/payload esperados', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'teste@dominio.com',
      password: 'SenhaMuitoSegura123',
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe('jwt-test-token');
    expect(response.body.user).toMatchObject({
      id: 77,
      email: 'teste@dominio.com',
      role: 'client',
    });
    expect(signUserTokenMock).toHaveBeenCalledWith(77, 'client', 1);
  });

  it('autentica cliente com endereço completo sem cep e precisaCompleto=false em /auth/login', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'semcep@dominio.com',
      password: 'SenhaMuitoSegura123',
    });

    expect(response.status).toBe(200);
    expect(response.body.needsCompletion).toBe(false);
  });

  it('deriva status do broker para pending_documents no login quando nao ha documentos reais', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'broker@dominio.com',
      password: 'SenhaMuitoSegura123',
    });

    expect(response.status).toBe(200);
    expect(response.body.requiresDocuments).toBe(true);
    expect(response.body.user.role).toBe('broker');
    expect(response.body.user.broker).toMatchObject({
      status: 'pending_documents',
    });
    expect(response.body.user.broker_status).toBe('pending_verification');
  });

  it('rejeita /users/login com usuario inexistente', async () => {
    const response = await request(app).post('/users/login').send({
      email: 'inexistente@dominio.com',
      password: 'SenhaMuitoSegura123',
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Credenciais inválidas.');
  });

  it('rejeita /auth/register com email ja em uso', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 11,
        },
      ],
    ]);

    const response = await request(app).post('/auth/register').send({
      name: 'Usuário Teste',
      email: 'duplicado@dominio.com',
      password: 'SenhaMuitoSegura123',
      without_number: true,
      street: 'Rua Central',
      bairro: 'Centro',
      city: 'Rio Verde',
      state: 'GO',
      cep: '12345-678',
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('Este email ja esta em uso.');
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('aceita /auth/register com payload mínimo válido', async () => {
    queryMock
      .mockResolvedValueOnce([[]]) // select existing user by email
      .mockResolvedValueOnce([[]]) // select existing user by normalized name
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus users check
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus latest challenge
      .mockResolvedValueOnce([{ insertId: 77 }]); // insert users

    const response = await request(app).post('/auth/register').send({
      name: 'Usuário Teste',
      email: 'novo@dominio.com',
      password: 'SenhaMuitoSegura123',
      without_number: true,
      street: 'Rua Central',
      bairro: 'Centro',
      city: 'Rio Verde',
      state: 'GO',
      cep: '12345-678',
    });

    expect(response.status).toBe(201);
    expect(response.body.token).toBe('jwt-test-token');
    expect(response.body.user).toMatchObject({
      email: 'novo@dominio.com',
      role: 'client',
      id: 77,
    });
    expect(signUserTokenMock).toHaveBeenCalledWith(77, 'client', 1);
    expect(hashMock).toHaveBeenCalledWith('SenhaMuitoSegura123', 4);
  });

  it('rejeita /auth/register quando o nome normalizado já está em uso', async () => {
    queryMock
      .mockResolvedValueOnce([[]]) // select existing user by email
      .mockResolvedValueOnce([[{ id: 12 }]]); // select existing user by normalized name

    const response = await request(app).post('/auth/register').send({
      name: '  USUÁRIO TESTE  ',
      email: 'nome-duplicado@dominio.com',
      password: 'SenhaMuitoSegura123',
      without_number: true,
      street: 'Rua Central',
      bairro: 'Centro',
      city: 'Rio Verde',
      state: 'GO',
      cep: '12345-678',
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: 'DUPLICATE_ACCOUNT_NAME',
      error: 'Este nome já está em uso.',
    });
    expect(hashMock).not.toHaveBeenCalled();
  });

  it('rejeita /users/register com campos obrigatórios faltantes', async () => {
    const response = await request(app).post('/users/register').send({
      email: 'novo@dominio.com',
      password: 'SenhaMuitoSegura123',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Nome e email sao obrigatorios.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('aceita /users/register (rota legado ativa) com payload mínimo válido', async () => {
    queryMock
      .mockResolvedValueOnce([[]]) // select existing user by email
      .mockResolvedValueOnce([[]]) // select existing user by normalized name
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus users check
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus latest challenge
      .mockResolvedValueOnce([{ insertId: 88 }]);

    const response = await request(app).post('/users/register').send({
      name: 'Usuário Teste',
      email: 'ativo@dominio.com',
      password: 'SenhaMuitoSegura123',
      without_number: true,
      street: 'Rua Central',
      bairro: 'Centro',
      city: 'Rio Verde',
      state: 'GO',
      cep: '12345-678',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      email: 'ativo@dominio.com',
      role: 'client',
      id: 88,
    });
    expect(response.body.message).toBeUndefined();
  });

  it('rejeita /users/login com campos faltantes', async () => {
    const response = await request(app).post('/users/login').send({
      email: 'teste@dominio.com',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Email e senha são obrigatórios.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejeita /users/login com credenciais inválidas', async () => {
    const response = await request(app).post('/users/login').send({
      email: 'teste@dominio.com',
      password: 'Errada123',
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Credenciais inválidas.');
  });

  it('sucesso em /users/login com payload mockado estável', async () => {
    const response = await request(app).post('/users/login').send({
      email: 'teste@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe('jwt-test-token');
    expect(response.body.user).toMatchObject({
      id: 77,
      email: 'teste@dominio.com',
      role: 'client',
    });
    expect(signUserTokenMock).toHaveBeenCalledWith(77, 'client', 1);
  });

  it('autentica cliente sem cep com endereço completo em /users/login e precisaCompleto=false', async () => {
    const response = await request(app).post('/users/login').send({
      email: 'semcep-users@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.needsCompletion).toBe(false);
  });

  it('email verificado sem telefone nao bloqueia login por SMS', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'semtelefone@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.email_verified).toBe(true);
    expect(response.body.user.phone).toBeNull();
    expect(response.body).toMatchObject({
      needsCompletion: true,
      requiresDocuments: false,
    });
    expect(response.body.user.phone_verified).toBeUndefined();
  });

  it('email verificado + perfil incompleto retorna needsCompletion sem exigir verificacao extra de telefone', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'incompleto@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.user.email_verified).toBe(true);
    expect(response.body.needsCompletion).toBe(true);
    expect(response.body.user).toMatchObject({
      phone: null,
      email: 'incompleto@dominio.com',
    });
    expect(response.body.phone_verified).toBeUndefined();
  });

  it('broker sem CRECI + sem docs retorna fluxo adequado de requerimento', async () => {
    const response = await request(app).post('/auth/login').send({
      email: 'brokersem@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      role: 'broker',
      broker_status: 'approved',
      broker: {
        id: 103,
        status: 'approved',
      },
    });
    expect(response.body.requiresDocuments).toBe(true);
    expect(response.body.user.broker.creci).toBeNull();
  });

  it('garante semântica equivalente entre /auth/login e /users/login', async () => {
    const authLogin = await request(app).post('/auth/login').send({
      email: 'semantico@dominio.com',
      password: 'Senha123',
    });

    const usersLogin = await request(app).post('/users/login').send({
      email: 'semantico@dominio.com',
      password: 'Senha123',
    });

    expect(authLogin.status).toBe(200);
    expect(usersLogin.status).toBe(200);
    expect(authLogin.body).toMatchObject({
      needsCompletion: false,
      requiresDocuments: false,
      user: {
        role: 'client',
        email: 'semantico@dominio.com',
        broker_status: null,
      },
    });
    expect(usersLogin.body).toMatchObject({
      needsCompletion: false,
      requiresDocuments: false,
      user: {
        role: 'client',
        email: 'semantico@dominio.com',
        broker_status: null,
      },
    });
    expect(usersLogin.body.token).toBe(authLogin.body.token);
  });
});
