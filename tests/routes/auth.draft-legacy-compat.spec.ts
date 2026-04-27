import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));
const { upsertFirebaseContextToDraftMock, verifyIdTokenMock } = vi.hoisted(() => ({
  upsertFirebaseContextToDraftMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
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
vi.mock('../../src/services/registrationDraftService', () => ({
  upsertFirebaseContextToDraft: upsertFirebaseContextToDraftMock,
}));

describe('Compatibilidade legado de auth/users durante mudança de draft', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');
    const { default: userRoutes } = await import('../../src/routes/user.routes');

    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
    app.use('/users', userRoutes);
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([[]]);
  });

  it('mantem /users/me protegido por auth middleware', async () => {
    const response = await request(app).get('/users/me');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Token não fornecido.');
  });

  it('mantem /users/login com erro de credenciais inválidas para usuário inexistente', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const response = await request(app).post('/users/login').send({
      email: 'ausente@dominio.com',
      password: 'xpto',
    });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Credenciais inválidas.');
  });

  it('mantem /users/auth/firebase em modo legado sem contexto de draft', async () => {
    verifyIdTokenMock.mockResolvedValue({
      uid: 'legacy-uid-firebase',
      email: 'legacy-user@dominio.com',
      name: 'Legacy Usuário',
      phone_number: '+5511999990000',
    });
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 111,
          name: 'Legacy Usuário',
          email: 'legacy-user@dominio.com',
          firebase_uid: 'legacy-uid-firebase',
          token_version: 7,
        },
      ],
    ]);

    const response = await request(app).post('/users/auth/firebase').send({
      idToken: 'idTokenLegacyFirebase',
    });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: 111,
      name: 'Legacy Usuário',
      email: 'legacy-user@dominio.com',
      role: 'client',
    });
    expect(response.body.token).toBeTruthy();
    expect(upsertFirebaseContextToDraftMock).not.toHaveBeenCalled();
  });

  it('mantem /users/auth/firebase em modo draft sem criar usuário final ainda', async () => {
    verifyIdTokenMock.mockResolvedValue({
      uid: 'uid-firebase',
      email: 'draft@dominio.com',
      name: 'Draft Nome',
      phone_number: '61999990000',
    });
    upsertFirebaseContextToDraftMock.mockResolvedValue({
      draftId: 'draft-xyz',
      profileType: 'client',
      email: 'draft@dominio.com',
      status: 'OPEN',
      currentStep: 'IDENTITY',
    });

    const response = await request(app).post('/users/auth/firebase').set({
      'x-draft-id': 'draft-xyz',
      'x-draft-token': 'tok-xyz',
    }).send({
      idToken: 'idTokenFirebase',
    });

    expect(response.status).toBe(200);
    expect(response.body.draft).toBeTruthy();
    expect(response.body.status).toBe('ok');
    expect(upsertFirebaseContextToDraftMock).toHaveBeenCalledWith(
      'draft-xyz',
      'tok-xyz',
      expect.objectContaining({
        firebaseUid: 'uid-firebase',
        email: 'draft@dominio.com',
      }),
    );
  });

  it('ignora contexto draft no /users/auth/firebase com fluxo draft desativado', async () => {
    process.env.AUTH_DRAFT_FLOW_ENABLED = 'false';
    verifyIdTokenMock.mockResolvedValue({
      uid: 'legacy-uid-firebase-disabled',
      email: 'legacy-disabled@dominio.com',
      name: 'Legacy Desligado',
      phone_number: '+5511999888777',
    });
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 333,
          name: 'Legacy Desligado',
          email: 'legacy-disabled@dominio.com',
          firebase_uid: 'legacy-uid-firebase-disabled',
          token_version: 9,
        },
      ],
    ]);

    const response = await request(app)
      .post('/users/auth/firebase')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok-disabled')
      .send({ idToken: 'idTokenLegacyFirebaseDisabled' });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      id: 333,
      email: 'legacy-disabled@dominio.com',
      role: 'client',
    });
    expect(response.body.token).toBeTruthy();
    expect(upsertFirebaseContextToDraftMock).not.toHaveBeenCalled();

    delete process.env.AUTH_DRAFT_FLOW_ENABLED;
  });
});
