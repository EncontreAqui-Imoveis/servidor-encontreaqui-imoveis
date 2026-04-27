import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  getDraftByDraftIdAndTokenMock,
  upsertDraftPhoneOtpMock,
  useDraftPhoneOtpMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getDraftByDraftIdAndTokenMock: vi.fn(),
  upsertDraftPhoneOtpMock: vi.fn(),
  useDraftPhoneOtpMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/registrationDraftRepository', async () => {
  const actual = await vi.importActual('../../src/services/registrationDraftRepository');
  return {
    ...(actual as Record<string, unknown>),
    getDraftByDraftIdAndToken: getDraftByDraftIdAndTokenMock,
    upsertDraftPhoneOtp: upsertDraftPhoneOtpMock,
    useDraftPhoneOtp: useDraftPhoneOtpMock,
  };
});

import { requestDraftPhoneOtp } from '../../src/services/registrationDraftService';

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

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PHONE_OTP_PROVIDER;
    queryMock.mockResolvedValueOnce([[]]);
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
  });

  it('falha ao requisitar OTP quando provider está desativado em produção', async () => {
    process.env.NODE_ENV = 'production';
    upsertDraftPhoneOtpMock.mockResolvedValueOnce(undefined);
    useDraftPhoneOtpMock.mockResolvedValueOnce(undefined);

    await expect(requestDraftPhoneOtp('draft-abc', 'tok', '61999998888')).rejects.toMatchObject({
      code: 'PHONE_OTP_DELIVERY_FAILED',
      statusCode: 503,
    });
    expect(upsertDraftPhoneOtpMock).toHaveBeenCalledTimes(1);
    expect(useDraftPhoneOtpMock).toHaveBeenCalledTimes(1);
  });

  it('continua retornando sucesso em ambiente de test (sem provider real)', async () => {
    process.env.NODE_ENV = 'test';
    upsertDraftPhoneOtpMock.mockResolvedValueOnce(undefined);
    const response = await requestDraftPhoneOtp('draft-abc', 'tok', '61999998888');

    expect(response).toHaveProperty('sessionToken');
    expect(response).toHaveProperty('code');
  });
});

