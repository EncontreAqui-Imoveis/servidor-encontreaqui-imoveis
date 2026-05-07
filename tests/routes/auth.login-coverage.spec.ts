import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { hashMock, queryMock, compareMock, signUserTokenMock } = vi.hoisted(() => ({
  hashMock: vi.fn(),
  queryMock: vi.fn(),
  compareMock: vi.fn(),
  signUserTokenMock: vi.fn(),
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
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 77,
          name: 'Usuario Teste',
          email: 'teste@dominio.com',
          email_verified_at: null,
          password_hash: 'bcrypt-hash',
          phone: '62999998888',
          street: 'Rua A',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '72900000',
          token_version: 1,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

    const response = await request(app).post('/auth/login').send({
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

  it('autentica cliente com endereço completo sem cep e precisaCompleto=false em /auth/login', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 78,
          name: 'Cliente Sem Cep',
          email: 'semcep@dominio.com',
          email_verified_at: null,
          password_hash: 'bcrypt-hash',
          phone: '62999990000',
          street: 'Rua Teste',
          number: '500',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: null,
          token_version: 1,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

    const response = await request(app).post('/auth/login').send({
      email: 'semcep@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.needsCompletion).toBe(false);
  });

  it('deriva status do broker para pending_documents no login quando nao ha documentos reais', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 101,
          name: 'Corretor Sem Docs',
          email: 'broker@dominio.com',
          email_verified_at: '2026-01-01T00:00:00.000Z',
          password_hash: 'bcrypt-hash',
          phone: '64999998888',
          street: 'Rua Corretor',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '75900000',
          token_version: 1,
          role: 'broker',
          broker_id: 101,
          broker_status: 'pending_verification',
          broker_profile_type: 'BROKER',
          broker_documents_status: null,
          creci: '12345678-A',
        },
      ],
    ]);

    const response = await request(app).post('/auth/login').send({
      email: 'broker@dominio.com',
      password: 'Senha123',
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
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app).post('/users/login').send({
      email: 'inexistente@dominio.com',
      password: 'Senha123',
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
      password: 'Senha123',
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
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus users check
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus latest challenge
      .mockResolvedValueOnce([{ insertId: 77 }]); // insert users

    const response = await request(app).post('/auth/register').send({
      name: 'Usuário Teste',
      email: 'novo@dominio.com',
      password: 'Senha123',
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
    expect(hashMock).toHaveBeenCalledWith('Senha123', 8);
  });

  it('rejeita /users/register com campos obrigatórios faltantes', async () => {
    const response = await request(app).post('/users/register').send({
      email: 'novo@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Nome e email sao obrigatorios.');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('aceita /users/register (rota legado ativa) com payload mínimo válido', async () => {
    queryMock
      .mockResolvedValueOnce([[]]) // select existing user by email
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus users check
      .mockResolvedValueOnce([[]]) // getEmailVerificationStatus latest challenge
      .mockResolvedValueOnce([{ insertId: 88 }]);

    const response = await request(app).post('/users/register').send({
      name: 'Usuário Teste',
      email: 'ativo@dominio.com',
      password: 'Senha123',
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
    queryMock.mockResolvedValueOnce([[]]);
    const response = await request(app).post('/users/login').send({
      email: 'teste@dominio.com',
      password: 'Errada123',
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Credenciais inválidas.');
  });

  it('sucesso em /users/login com payload mockado estável', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 88,
          name: 'Cliente Teste',
          email: 'teste@dominio.com',
          email_verified_at: new Date().toISOString(),
          password_hash: 'bcrypt-hash',
          phone: '62999998888',
          street: 'Rua A',
          number: '10',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '72900000',
          token_version: 3,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

    const response = await request(app).post('/users/login').send({
      email: 'teste@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe('jwt-test-token');
    expect(response.body.user).toMatchObject({
      id: 88,
      email: 'teste@dominio.com',
      role: 'client',
    });
    expect(signUserTokenMock).toHaveBeenCalledWith(88, 'client', 3);
  });

  it('autentica cliente sem cep com endereço completo em /users/login e precisaCompleto=false', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 89,
          name: 'Cliente Sem Cep Users',
          email: 'semcep-users@dominio.com',
          email_verified_at: '2026-01-01T00:00:00.000Z',
          password_hash: 'bcrypt-hash',
          phone: '62999990001',
          street: 'Rua Users',
          number: '701',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: null,
          token_version: 1,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

    const response = await request(app).post('/users/login').send({
      email: 'semcep-users@dominio.com',
      password: 'Senha123',
    });

    expect(response.status).toBe(200);
    expect(response.body.needsCompletion).toBe(false);
  });

  it('email verificado sem telefone nao bloqueia login por SMS', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 101,
          name: 'Cliente Sem Telefone',
          email: 'semtelefone@dominio.com',
          email_verified_at: '2026-01-01T00:00:00.000Z',
          password_hash: 'bcrypt-hash',
          phone: null,
          street: 'Rua A',
          number: '100',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '72900000',
          token_version: 4,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

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
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 102,
          name: 'Cliente Incompleto',
          email: 'incompleto@dominio.com',
          email_verified_at: '2026-01-01T00:00:00.000Z',
          password_hash: 'bcrypt-hash',
          phone: null,
          street: null,
          number: null,
          complement: null,
          bairro: null,
          city: null,
          state: 'GO',
          cep: null,
          token_version: 1,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

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
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 103,
          name: 'Broker Sem Dados',
          email: 'brokersem@dominio.com',
          email_verified_at: null,
          password_hash: 'bcrypt-hash',
          phone: '62999998888',
          street: 'Rua B',
          number: '45',
          complement: 'Apto 1',
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '72900000',
          token_version: 6,
          role: 'broker',
          broker_id: 103,
          broker_status: 'approved',
          broker_profile_type: 'BROKER',
          broker_documents_status: null,
          creci: null,
        },
      ],
    ]);

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
    const authRow = [
      [
        {
          id: 104,
          name: 'Cliente Semantico',
          email: 'semantico@dominio.com',
          email_verified_at: '2026-01-01T00:00:00.000Z',
          password_hash: 'bcrypt-hash',
          phone: '62999998888',
          street: 'Rua C',
          number: '22',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '72900000',
          token_version: 2,
          broker_id: null,
          broker_status: null,
          broker_profile_type: null,
          broker_documents_status: null,
          creci: null,
        },
      ],
    ];

    queryMock.mockResolvedValueOnce(authRow);
    const authLogin = await request(app).post('/auth/login').send({
      email: 'semantico@dominio.com',
      password: 'Senha123',
    });

    vi.clearAllMocks();
    compareMock.mockResolvedValue(true);
    signUserTokenMock.mockReturnValue('jwt-test-token');
    queryMock.mockResolvedValueOnce(authRow);

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
