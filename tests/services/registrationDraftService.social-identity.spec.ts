import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), query: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(),
  commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), begin: vi.fn(),
}));
vi.mock('../../src/config/firebaseAdmin', () => ({
  default: { auth: () => ({ verifyIdToken: mocks.verify }) },
}));
vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    query: mocks.query,
    getConnection: async () => ({
      query: mocks.query, beginTransaction: mocks.begin, commit: mocks.commit,
      rollback: mocks.rollback, release: mocks.release,
    }),
  },
}));
vi.mock('../../src/services/registrationDraftRepository', async importOriginal => ({
  ...await importOriginal<object>(),
  discardExpiredDrafts: vi.fn(), findOpenDraftByEmail: vi.fn(),
  createDraft: mocks.create, getDraftByDraftIdAndToken: mocks.get,
  getDraftByDraftId: mocks.get, updateDraftByDraftId: mocks.update,
}));
vi.mock('../../src/services/authSessionService', () => ({
  signUserToken: () => 'jwt', buildUserPayload: (row: unknown) => row,
  hasCompleteProfile: () => true,
}));

import {
  createRegistrationDraft, finalizeRegistrationDraft, patchRegistrationDraft, upsertFirebaseContextToDraft,
} from '../../src/services/registrationDraftService';

const identity = { firebaseUid: 'google-uid', email: 'google@example.com', provider: 'google' };
const input = { idToken: 'valid-token', name: 'Google User', email: identity.email, authProvider: 'google' as const };
const appleIdentity = { firebaseUid: 'apple-uid', email: 'user@privaterelay.appleid.com', provider: 'apple' as const };
const appleInput = { idToken: 'apple-token', name: 'Apple User', email: appleIdentity.email, authProvider: 'apple' as const };
const legal = { acceptedTerms: true, acceptedPrivacyPolicy: true, termsVersion: 'v1', privacyPolicyVersion: 'v1' };

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, draft_id: 'draft-social', status: 'OPEN', profile_type: 'client',
    name: input.name, email: identity.email, auth_provider: 'google',
    firebase_uid: identity.firebaseUid, google_uid: identity.firebaseUid,
    password_hash: null, password_hash_expires_at: null,
    expires_at: new Date(Date.now() + 3600000),
    provider_metadata: JSON.stringify({ verifiedSocialIdentity: { version: 1, ...identity } }),
    ...overrides,
  };
}

function appleDraft(overrides: Record<string, unknown> = {}) {
  return draft({
    name: appleInput.name,
    email: appleIdentity.email,
    auth_provider: 'apple',
    firebase_uid: appleIdentity.firebaseUid,
    google_uid: appleIdentity.firebaseUid,
    provider_metadata: JSON.stringify({ verifiedSocialIdentity: { version: 1, ...appleIdentity } }),
    ...overrides,
  });
}

function arrangeFinalize(row = draft(), byUid: unknown = null, byEmail: unknown = null) {
  mocks.get.mockResolvedValue(row);
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM registration_drafts')) return [[{ ...row }]];
    if (sql.includes('WHERE firebase_uid =')) return [byUid ? [byUid] : []];
    if (sql.includes('WHERE email =')) return [byEmail ? [byEmail] : []];
    if (sql.includes('INSERT INTO users')) return [{ insertId: 501 }];
    if (sql.includes('WHERE u.id =')) return [[{ id: 501, email: row.email }]];
    return [[]];
  });
}

describe('identidade comprovada no cadastro social por rascunho', () => {
  beforeEach(() => {
    mocks.verify.mockResolvedValue({ uid: identity.firebaseUid, email: identity.email,
      email_verified: true, firebase: { sign_in_provider: 'google.com' } });
    mocks.query.mockResolvedValue([[]]);
    mocks.create.mockResolvedValue(draft());
  });

  it('valida o token e persiste somente a identidade Google comprovada', async () => {
    await createRegistrationDraft({ ...input, googleUid: identity.firebaseUid, firebaseUid: identity.firebaseUid });
    expect(mocks.verify).toHaveBeenCalledWith('valid-token');
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      authProvider: 'google', googleUid: identity.firebaseUid, firebaseUid: identity.firebaseUid,
      email: identity.email, emailVerifiedAt: expect.any(Date), passwordHash: null,
      providerMetadata: { verifiedSocialIdentity: { version: 1, ...identity } },
    }));
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('valid-token');
  });

  it('deriva identidade mesmo sem UID, email ou provider no payload', async () => {
    await createRegistrationDraft({ idToken: 'valid-token', name: input.name, email: '' });
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      firebaseUid: identity.firebaseUid, email: identity.email, authProvider: 'google',
    }));
  });

  it('não cria rascunho para identidade vinculada a uma conta em exclusão', async () => {
    mocks.query.mockResolvedValueOnce([[
      { id: 10, deletion_requested_at: new Date() },
    ]]);

    await expect(createRegistrationDraft(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { code: 'ACCOUNT_DELETION_PENDING', retryable: false },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('aceita token Apple verificado e e-mail private relay ao criar rascunho', async () => {
    mocks.verify.mockResolvedValue({ uid: appleIdentity.firebaseUid, email: appleIdentity.email,
      email_verified: true, firebase: { sign_in_provider: 'apple.com' } });

    await createRegistrationDraft({ ...appleInput, googleUid: appleIdentity.firebaseUid, firebaseUid: appleIdentity.firebaseUid });

    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      authProvider: 'apple', googleUid: appleIdentity.firebaseUid, firebaseUid: appleIdentity.firebaseUid,
      email: appleIdentity.email, emailVerifiedAt: expect.any(Date), passwordHash: null,
      providerMetadata: { verifiedSocialIdentity: { version: 1, ...appleIdentity } },
    }));
  });

  it.each([{ googleUid: 'attacker' }, { firebaseUid: 'attacker' },
    { email: 'attacker@example.com' }, { authProvider: 'apple' }])(
    'rejeita dados do cliente incompatíveis: %j', async override => {
      await expect(createRegistrationDraft({ ...input, ...override } as any))
        .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_MISMATCH' } });
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('rejeita cadastro social sem token, mesmo com senha e provider email', async () => {
    await expect(createRegistrationDraft({ ...input, idToken: undefined,
      authProvider: 'email', googleUid: identity.firebaseUid, password: 'SenhaSegura123!' }))
      .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_TOKEN_REQUIRED' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejeita token inválido ou expirado sem persistir', async () => {
    mocks.verify.mockRejectedValue(new Error('expired'));
    await expect(createRegistrationDraft(input)).rejects.toMatchObject({
      details: { code: 'SOCIAL_IDENTITY_TOKEN_INVALID' },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['facebook.com', 'password', 'phone'])('rejeita token de provider não permitido: %s', async provider => {
    mocks.verify.mockResolvedValue({ uid: identity.firebaseUid, email: identity.email,
      email_verified: true, firebase: { sign_in_provider: provider } });
    await expect(createRegistrationDraft(input)).rejects.toMatchObject({
      details: { code: 'SOCIAL_IDENTITY_PROVIDER_UNSUPPORTED' },
    });
  });

  it('não usa email não verificado para vincular identidade', async () => {
    mocks.verify.mockResolvedValue({ uid: identity.firebaseUid, email: identity.email,
      email_verified: false, firebase: { sign_in_provider: 'google.com' } });
    await expect(createRegistrationDraft(input)).rejects.toMatchObject({
      details: { code: 'SOCIAL_IDENTITY_TOKEN_INVALID' },
    });
  });

  it('PATCH não sobrescreve a identidade nem aceita prova fornecida pelo cliente', async () => {
    mocks.get.mockResolvedValue(draft());
    await patchRegistrationDraft('draft-social', 'draft-token', {
      email: 'attacker@example.com', firebaseUid: 'attacker', googleUid: 'attacker',
      authProvider: 'email', providerMetadata: { verifiedSocialIdentity: identity },
    } as any);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    [{ id: 10, firebase_uid: identity.firebaseUid }, { id: 20, firebase_uid: 'other' }],
    [null, { id: 20, firebase_uid: 'other' }],
    [null, { id: 20, firebase_uid: null }],
    [{ id: 10, firebase_uid: identity.firebaseUid }, null],
  ])('impede finalizar com conflito entre UID/email e contas existentes', async (byUid, byEmail) => {
    arrangeFinalize(draft(), byUid, byEmail);
    await expect(finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal))
      .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_CONFLICT' } });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE firebase_uid = ? LIMIT 1 FOR UPDATE'), [identity.firebaseUid]);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('WHERE email = ? LIMIT 1 FOR UPDATE'), [identity.email]);
    expect(mocks.query.mock.calls.some(([sql]) => /INSERT INTO users|UPDATE users|DELETE FROM users/.test(sql))).toBe(false);
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('não finaliza rascunho antigo vinculado a uma conta em exclusão', async () => {
    arrangeFinalize(draft(), {
      id: 10,
      firebase_uid: identity.firebaseUid,
      deletion_requested_at: new Date(),
    });

    await expect(finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal))
      .rejects.toMatchObject({
        code: 'FORBIDDEN',
        details: { code: 'ACCOUNT_DELETION_PENDING', retryable: false },
      });
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(false);
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('conclui Google comprovado usando o UID validado e o id criado pelo banco', async () => {
    arrangeFinalize();
    const result = await finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal);
    expect(result.user.id).toBe(501);
    const insert = mocks.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'))!;
    expect(insert[1].slice(0, 5)).toEqual([identity.firebaseUid, input.name, identity.email, expect.any(Date), null]);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('conclui Apple comprovado usando a identidade do token', async () => {
    mocks.verify.mockResolvedValue({ uid: appleIdentity.firebaseUid, email: appleIdentity.email,
      email_verified: true, firebase: { sign_in_provider: 'apple.com' } });
    arrangeFinalize(appleDraft());

    const result = await finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal, {}, {
      idToken: 'apple-token', authProvider: 'apple',
    });

    expect(result.user.id).toBe(501);
    expect(mocks.verify).toHaveBeenCalledWith('apple-token');
    const insert = mocks.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO users'))!;
    expect(insert[1].slice(0, 5)).toEqual([
      appleIdentity.firebaseUid, appleInput.name, appleIdentity.email, expect.any(Date), null,
    ]);
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('aceita dados redundantes compatíveis na finalização sem exigir outro token', async () => {
    arrangeFinalize();
    await finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal, {}, {
      googleUid: identity.firebaseUid, email: identity.email, authProvider: 'google',
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('aceita metadata Apple comprovada na finalização sem exigir outro token', async () => {
    arrangeFinalize(appleDraft());
    await finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal, {}, {
      firebaseUid: appleIdentity.firebaseUid, googleUid: appleIdentity.firebaseUid,
      email: appleIdentity.email, authProvider: 'apple',
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it('rejeita email divergente na finalização mesmo com identidade já comprovada', async () => {
    arrangeFinalize();
    await expect(finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal, {}, {
      email: 'other@example.com',
    })).rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_MISMATCH' } });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('rejeita prova persistida que não corresponde ao UID do rascunho', async () => {
    arrangeFinalize(draft({ firebase_uid: 'changed-uid' }));
    await expect(finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal))
      .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_TOKEN_REQUIRED' } });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('faz rollback se a restrição única detectar conflito concorrente na inserção', async () => {
    arrangeFinalize();
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO users')) throw Object.assign(new Error('Duplicate UID'), { code: 'ER_DUP_ENTRY' });
      return query(sql, params);
    });
    await expect(finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal))
      .rejects.toMatchObject({ code: 'DRAFT_DUPLICATE_ACCOUNT' });
    expect(mocks.rollback).toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it('preserva rascunho antigo e exige nova prova antes de finalizar', async () => {
    arrangeFinalize(draft({ provider_metadata: null }));
    await expect(finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal))
      .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_TOKEN_REQUIRED' } });
    expect(mocks.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql.replace('FOR UPDATE', '')))).toBe(false);
  });

  it('finaliza rascunho antigo com apenas google_uid após receber novo token compatível', async () => {
    arrangeFinalize(draft({ provider_metadata: null, firebase_uid: null }));
    const result = await finalizeRegistrationDraft('draft-social', 'draft-token', 'submit_documents', legal, {}, { googleIdToken: 'valid-token' });
    expect(result.user.id).toBe(501);
    expect(mocks.verify).toHaveBeenCalledWith('valid-token');
  });

  it('revalida rascunho antigo pelo endpoint Firebase existente sem perder endereço ou documentos', async () => {
    mocks.verify.mockResolvedValue({ uid: identity.firebaseUid, email: identity.email,
      email_verified: true, firebase: { sign_in_provider: 'google.com' },
      name: 'Nome Google', phone_number: '+5511999999999' });
    arrangeFinalize(draft({ provider_metadata: null, firebase_uid: null }));
    await upsertFirebaseContextToDraft('draft-social', 'draft-token', { idToken: 'valid-token' });
    expect(mocks.update).toHaveBeenCalledWith('draft-social', expect.any(String), expect.objectContaining({
      firebaseUid: identity.firebaseUid, googleUid: identity.firebaseUid, authProvider: 'google',
      name: 'Nome Google', phone: '+5511999999999',
      providerMetadata: { verifiedSocialIdentity: { version: 1, ...identity } },
    }), expect.objectContaining({ query: mocks.query }));
    expect(mocks.update.mock.calls[0][2]).not.toHaveProperty('street');
    expect(mocks.query.mock.calls.some(([sql]) => sql.includes('DELETE'))).toBe(false);
  });

  it('não retoma rascunho com identidade vinculada a uma conta em exclusão', async () => {
    const row = draft();
    mocks.get.mockResolvedValue(row);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM registration_drafts')) return [[{ ...row }]];
      if (sql.includes('SELECT id, deletion_requested_at FROM users')) {
        return [[{ id: 10, deletion_requested_at: new Date() }]];
      }
      return [[]];
    });

    await expect(upsertFirebaseContextToDraft('draft-social', 'draft-token', {
      idToken: 'valid-token',
    })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      details: { code: 'ACCOUNT_DELETION_PENDING', retryable: false },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalled();
  });

  it('atualiza e retoma rascunho Apple somente com token Firebase válido', async () => {
    mocks.verify.mockResolvedValue({ uid: appleIdentity.firebaseUid, email: appleIdentity.email,
      email_verified: true, firebase: { sign_in_provider: 'apple.com' },
      name: 'Nome Apple', phone_number: '+5511988888888' });
    arrangeFinalize(appleDraft());

    await upsertFirebaseContextToDraft('draft-social', 'draft-token', {
      idToken: 'apple-token', authProvider: 'apple.com' as any,
    });

    expect(mocks.update).toHaveBeenCalledWith('draft-social', expect.any(String), expect.objectContaining({
      firebaseUid: appleIdentity.firebaseUid, googleUid: appleIdentity.firebaseUid, authProvider: 'apple',
      name: 'Nome Apple', phone: '+5511988888888',
      providerMetadata: { verifiedSocialIdentity: { version: 1, ...appleIdentity } },
    }), expect.objectContaining({ query: mocks.query }));
  });

  it.each([
    { authProvider: 'google' },
    { firebaseUid: 'attacker' },
    { email: 'attacker@example.com' },
  ])('rejeita dados Apple do cliente divergentes do token: %j', async override => {
    mocks.verify.mockResolvedValue({ uid: appleIdentity.firebaseUid, email: appleIdentity.email,
      email_verified: true, firebase: { sign_in_provider: 'apple.com' } });

    await expect(createRegistrationDraft({ ...appleInput, ...override } as any))
      .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_MISMATCH' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('não permite trocar identidade do rascunho por outro token válido', async () => {
    arrangeFinalize(draft({ firebase_uid: 'original-uid', google_uid: 'original-uid' }));
    await expect(upsertFirebaseContextToDraft('draft-social', 'draft-token', { idToken: 'valid-token' }))
      .rejects.toMatchObject({ details: { code: 'SOCIAL_IDENTITY_MISMATCH' } });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rollback).toHaveBeenCalled();
  });
});
