import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  beginTransactionMock,
  commitMock,
  getConnectionMock,
  queryMock,
  releaseMock,
  rollbackMock,
  getDraftByDraftIdAndTokenMock,
  updateDraftByDraftIdMock,
  verifyEmailCodeMock,
} = vi.hoisted(() => ({
  beginTransactionMock: vi.fn(),
  commitMock: vi.fn(),
  getConnectionMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  rollbackMock: vi.fn(),
  getDraftByDraftIdAndTokenMock: vi.fn(),
  updateDraftByDraftIdMock: vi.fn(),
  verifyEmailCodeMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/registrationDraftRepository', async () => {
  const actual = await vi.importActual('../../src/services/registrationDraftRepository');
  return {
    ...(actual as Record<string, unknown>),
    getDraftByDraftIdAndToken: getDraftByDraftIdAndTokenMock,
    updateDraftByDraftId: updateDraftByDraftIdMock,
  };
});

vi.mock('../../src/services/emailCodeChallengeService', async () => {
  const actual = await vi.importActual('../../src/services/emailCodeChallengeService');
  return {
    ...(actual as Record<string, unknown>),
    verifyEmailCode: verifyEmailCodeMock,
  };
});

import { confirmDraftEmailCode } from '../../src/services/registrationDraftService';

const dbConnection = {
  beginTransaction: beginTransactionMock,
  commit: commitMock,
  query: queryMock,
  rollback: rollbackMock,
  release: releaseMock,
};

function buildDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    draft_id: 'draft-abc',
    draft_token_hash: 'token-hash',
    status: 'OPEN',
    profile_type: 'client',
    email: 'usuario@dominio.com',
    email_normalized: 'usuario@dominio.com',
    name: 'Usuario',
    phone: '61999998888',
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

describe('confirmDraftEmailCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(dbConnection);
  });

  it('confirma com sucesso e consome challenge somente no final da transação', async () => {
    const now = new Date();
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(buildDraftRow({ draft_token_hash: 'sha256-token' }));
    verifyEmailCodeMock.mockResolvedValueOnce({ status: 'verified', verifiedAt: now, challengeId: 77 });
    updateDraftByDraftIdMock.mockResolvedValueOnce(undefined);
    queryMock.mockResolvedValueOnce([[], []]);

    const result = await confirmDraftEmailCode('draft-abc', 'tok', '123456');

    expect(result).toEqual({ status: 'verified', verifiedAt: now.toISOString() });
    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-abc',
      expect.any(String),
      { emailVerifiedAt: now },
      expect.objectContaining({ query: expect.any(Function) }),
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE email_code_challenges"),
      [now, 77],
    );
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO users'), expect.any(Array));
    expect(commitMock).toHaveBeenCalledTimes(1);
  });

  it('não consome challenge se atualização do draft falhar e propaga erro controlado', async () => {
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(buildDraftRow());
    verifyEmailCodeMock.mockResolvedValueOnce({ status: 'verified', verifiedAt: new Date(), challengeId: 77 });
    updateDraftByDraftIdMock.mockRejectedValueOnce(new Error('erro simulado no update'));

    await expect(confirmDraftEmailCode('draft-abc', 'tok', '123456')).rejects.toMatchObject({
      code: 'EMAIL_CODE_CONFIRM_FAILED',
    });
    expect(queryMock).not.toHaveBeenCalled();
    expect(rollbackMock).toHaveBeenCalledTimes(1);
  });

  it('permite nova tentativa após falha de atualização do draft (retry)', async () => {
    const now = new Date();
    getDraftByDraftIdAndTokenMock.mockResolvedValue(buildDraftRow());
    verifyEmailCodeMock
      .mockResolvedValueOnce({ status: 'verified', verifiedAt: now, challengeId: 77 })
      .mockResolvedValueOnce({ status: 'verified', verifiedAt: now, challengeId: 77 });
    updateDraftByDraftIdMock
      .mockRejectedValueOnce(new Error('falha temporaria'))
      .mockResolvedValueOnce(undefined);
    queryMock.mockResolvedValue([[], []]);

    await expect(confirmDraftEmailCode('draft-abc', 'tok', '123456')).rejects.toMatchObject({
      code: 'EMAIL_CODE_CONFIRM_FAILED',
    });
    const result = await confirmDraftEmailCode('draft-abc', 'tok', '123456');
    expect(result).toEqual({ status: 'verified', verifiedAt: now.toISOString() });

    expect(verifyEmailCodeMock).toHaveBeenCalledTimes(2);
    expect(updateDraftByDraftIdMock).toHaveBeenCalledTimes(2);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

