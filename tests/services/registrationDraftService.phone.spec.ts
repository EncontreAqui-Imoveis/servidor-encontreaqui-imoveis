import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authQueryMock,
  getDraftByDraftIdAndTokenMock,
  upsertDraftPhoneOtpMock,
  useDraftPhoneOtpMock,
  getDraftPhoneOtpBySessionTokenMock,
  updateDraftByDraftIdMock,
  verifyIdTokenMock,
  firebaseAuthMock,
} = vi.hoisted(() => ({
  authQueryMock: vi.fn(),
  getDraftByDraftIdAndTokenMock: vi.fn(),
  upsertDraftPhoneOtpMock: vi.fn(),
  useDraftPhoneOtpMock: vi.fn(),
  getDraftPhoneOtpBySessionTokenMock: vi.fn(),
  updateDraftByDraftIdMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
  firebaseAuthMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    query: authQueryMock,
  },
}));

vi.mock('../../src/config/firebaseAdmin', () => ({
  default: {
    auth: firebaseAuthMock,
    messaging: vi.fn(),
  },
}));

vi.mock('../../src/services/registrationDraftRepository', async () => {
  const actual = await vi.importActual('../../src/services/registrationDraftRepository');
  return {
    ...(actual as Record<string, unknown>),
    getDraftByDraftIdAndToken: getDraftByDraftIdAndTokenMock,
    upsertDraftPhoneOtp: upsertDraftPhoneOtpMock,
    useDraftPhoneOtp: useDraftPhoneOtpMock,
    getDraftPhoneOtpBySessionToken: getDraftPhoneOtpBySessionTokenMock,
    updateDraftByDraftId: updateDraftByDraftIdMock,
  };
});

import { confirmDraftPhoneOtp, requestDraftPhoneOtp } from '../../src/services/registrationDraftService';

function buildDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    draft_id: 'draft-abc',
    draft_token_hash: 'token-hash',
    status: 'OPEN',
    profile_type: 'client',
    email: 'usuario@dominio.com',
    email_normalized: 'usuario@dominio.com',
    name: 'Usuario',
    phone: null,
    street: null,
    number: null,
    complement: null,
    bairro: null,
    city: null,
    state: null,
    cep: null,
    without_number: 0,
    creci: null,
    auth_provider: 'email',
    google_uid: null,
    firebase_uid: null,
    provider_aud: null,
    provider_metadata: null,
    email_verified_at: null,
    phone_verified_at: null,
    password_hash: null,
    password_hash_expires_at: null,
    current_step: 'VERIFICATION',
    revision: 1,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    discarded_at: null,
    user_id: null,
    id: 123,
    ...overrides,
  };
}

describe('requestDraftPhoneOtp', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProvider = process.env.PHONE_OTP_PROVIDER;
  const previousDraftVerifyProvider = process.env.DRAFT_VERIFY_PHONE_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PHONE_OTP_PROVIDER;
    delete process.env.DRAFT_VERIFY_PHONE_PROVIDER;
    firebaseAuthMock.mockReturnValue({ verifyIdToken: verifyIdTokenMock });
    authQueryMock.mockResolvedValue([[]]);
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(buildDraftRow());
  });

  afterEach(() => {
    if (typeof previousNodeEnv === 'string') {
      process.env.NODE_ENV = previousNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (typeof previousProvider === 'string') {
      process.env.PHONE_OTP_PROVIDER = previousProvider;
    } else {
      delete process.env.PHONE_OTP_PROVIDER;
    }
    if (typeof previousDraftVerifyProvider === 'string') {
      process.env.DRAFT_VERIFY_PHONE_PROVIDER = previousDraftVerifyProvider;
    } else {
      delete process.env.DRAFT_VERIFY_PHONE_PROVIDER;
    }
  });

  it('falha ao requisitar OTP quando verificação indisponível em produção', async () => {
    process.env.NODE_ENV = 'production';
    upsertDraftPhoneOtpMock.mockResolvedValueOnce(undefined);
    useDraftPhoneOtpMock.mockResolvedValueOnce(undefined);

    await expect(requestDraftPhoneOtp('draft-abc', 'tok', '61999998888')).rejects.toMatchObject({
      code: 'PHONE_VERIFICATION_UNAVAILABLE',
      statusCode: 503,
    });
    expect(upsertDraftPhoneOtpMock).not.toHaveBeenCalled();
    expect(useDraftPhoneOtpMock).not.toHaveBeenCalled();
  });

  it('usa fluxo firebase quando configurado para registrar apenas o telefone', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PHONE_OTP_PROVIDER = 'firebase';
    updateDraftByDraftIdMock.mockResolvedValueOnce(undefined);

    const response = await requestDraftPhoneOtp('draft-abc', 'tok', '55 11 99999-0000');

    expect(response).toEqual({
      mode: 'firebase',
      requiresFirebaseIdToken: true,
      phone: '5511999990000',
    });
    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith('draft-abc', expect.any(String), {
      phone: '5511999990000',
    });
    expect(upsertDraftPhoneOtpMock).not.toHaveBeenCalled();
    expect(useDraftPhoneOtpMock).not.toHaveBeenCalled();
  });

  it('usa fluxo firebase mesmo com valor com aspas no provider', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PHONE_OTP_PROVIDER = '"firebase"';
    updateDraftByDraftIdMock.mockResolvedValueOnce(undefined);

    const response = await requestDraftPhoneOtp('draft-abc', 'tok', '55 11 99999-0001');

    expect(response).toEqual({
      mode: 'firebase',
      requiresFirebaseIdToken: true,
      phone: '5511999990001',
    });
    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith('draft-abc', expect.any(String), {
      phone: '5511999990001',
    });
    expect(upsertDraftPhoneOtpMock).not.toHaveBeenCalled();
    expect(useDraftPhoneOtpMock).not.toHaveBeenCalled();
  });

  it('continua retornando sucesso em ambiente de test (sem provider real)', async () => {
    process.env.NODE_ENV = 'test';
    upsertDraftPhoneOtpMock.mockResolvedValueOnce(undefined);
    const response = await requestDraftPhoneOtp('draft-abc', 'tok', '61999998888');

    expect(response).toHaveProperty('sessionToken');
    expect(response).toHaveProperty('code');
  });
});

describe('confirmDraftPhoneOtp', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousProvider = process.env.PHONE_OTP_PROVIDER;
  const previousDraftVerifyProvider = process.env.DRAFT_VERIFY_PHONE_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PHONE_OTP_PROVIDER = 'firebase';
    process.env.NODE_ENV = 'production';
    firebaseAuthMock.mockReturnValue({ verifyIdToken: verifyIdTokenMock });
    getDraftByDraftIdAndTokenMock.mockResolvedValue(buildDraftRow());
    authQueryMock.mockResolvedValue([[]]);
  });

  afterEach(() => {
    if (typeof previousNodeEnv === 'string') {
      process.env.NODE_ENV = previousNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (typeof previousProvider === 'string') {
      process.env.PHONE_OTP_PROVIDER = previousProvider;
    } else {
      delete process.env.PHONE_OTP_PROVIDER;
    }
    if (typeof previousDraftVerifyProvider === 'string') {
      process.env.DRAFT_VERIFY_PHONE_PROVIDER = previousDraftVerifyProvider;
    } else {
      delete process.env.DRAFT_VERIFY_PHONE_PROVIDER;
    }
  });

  it('confirma token Firebase com sucesso e registra phoneVerifiedAt', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      phone_number: '+55 11 98888-7777',
    });
    updateDraftByDraftIdMock.mockResolvedValueOnce(undefined);

    const response = await confirmDraftPhoneOtp(
      'draft-abc',
      'tok',
      'session-legacy',
      '123456',
      'firebase-id-token',
    );

    expect(response).toMatchObject({
      status: 'verified',
      phone: '5511988887777',
    });
    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith('draft-abc', expect.any(String), {
      phone: '5511988887777',
      phoneVerifiedAt: expect.any(Date),
      currentStep: 'VERIFICATION',
    });
    expect(verifyIdTokenMock).toHaveBeenCalledWith('firebase-id-token');
    expect(getDraftPhoneOtpBySessionTokenMock).not.toHaveBeenCalled();
  });

  it('retorna erro se token Firebase não possuir phone_number', async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: 'uid-1',
    });

    await expect(
      confirmDraftPhoneOtp('draft-abc', 'tok', 'session-legacy', '123456', 'firebase-id-token'),
    ).rejects.toMatchObject({
      code: 'PHONE_FIREBASE_TOKEN_INVALID',
      statusCode: 400,
    });
  });

  it('retorna erro de mismatch quando token Firebase difere do telefone do draft', async () => {
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(buildDraftRow({ phone: '5511990000000' }));
    verifyIdTokenMock.mockResolvedValueOnce({
      phone_number: '+55 11 98888-7777',
    });

    await expect(
      confirmDraftPhoneOtp('draft-abc', 'tok', 'session-legacy', '123456', 'firebase-id-token'),
    ).rejects.toMatchObject({
      code: 'PHONE_MISMATCH',
      statusCode: 409,
    });
    expect(updateDraftByDraftIdMock).not.toHaveBeenCalled();
  });

  it('exige token Firebase quando provider está em modo firebase', async () => {
    await expect(confirmDraftPhoneOtp('draft-abc', 'tok', 'session-legacy', '123456')).rejects.toMatchObject({
      code: 'PHONE_FIREBASE_TOKEN_REQUIRED',
      statusCode: 400,
    });
  });
});

