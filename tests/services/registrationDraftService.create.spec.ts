import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'dotenv/config';

const { queryMock, createDraftMock, discardExpiredDraftsMock, findOpenDraftByEmailMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createDraftMock: vi.fn(),
  discardExpiredDraftsMock: vi.fn(),
  findOpenDraftByEmailMock: vi.fn(),
}));

vi.mock('../../src/database/connection', () => ({
  __esModule: true,
  default: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/registrationDraftRepository', async () => {
  const actual = await vi.importActual('../../src/services/registrationDraftRepository');
  return {
    ...(actual as Record<string, unknown>),
    createDraft: createDraftMock,
    discardExpiredDrafts: discardExpiredDraftsMock,
    findOpenDraftByEmail: findOpenDraftByEmailMock,
  };
});

import { createRegistrationDraft } from '../../src/services/registrationDraftService';

function buildDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    draft_id: 'draft-abc',
    draft_token_hash: 'token-hash',
    status: 'OPEN',
    profile_type: 'client',
    email: 'novo@dominio.com',
    email_normalized: 'novo@dominio.com',
    name: 'Usuario',
    phone: '61999999999',
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
    current_step: 'IDENTITY',
    revision: 1,
    expires_at: new Date('2026-04-27T00:00:00.000Z'),
    created_at: new Date('2026-04-27T00:00:00.000Z'),
    updated_at: new Date('2026-04-27T00:00:00.000Z'),
    completed_at: null,
    discarded_at: null,
    user_id: null,
    id: 1,
    ...overrides,
  };
}

describe('createRegistrationDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aceita criação com email/nome/telefone sem endereço', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    findOpenDraftByEmailMock.mockResolvedValueOnce(null);
    createDraftMock.mockResolvedValueOnce(buildDraftRow());

    await createRegistrationDraft({
      email: 'novo@dominio.com',
      name: 'Usuario',
      password: 'Senha123',
      phone: '61999999999',
      profileType: 'client',
    });

    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
      street: undefined,
      number: undefined,
      complement: undefined,
      bairro: undefined,
      city: undefined,
      state: undefined,
      cep: undefined,
    }));
    expect(createDraftMock).toHaveBeenCalledTimes(1);
    const draftPayload = createDraftMock.mock.calls[0]?.[0];
    expect(draftPayload.draftId).toHaveLength(36);
    expect(draftPayload.draftId.startsWith('draft-')).toBe(false);
  });

  it('aceita criação com campos de endereço vazios', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    findOpenDraftByEmailMock.mockResolvedValueOnce(null);
    createDraftMock.mockResolvedValueOnce(buildDraftRow());

    await createRegistrationDraft({
      email: 'vazio@dominio.com',
      name: 'Usuario',
      password: 'Senha123',
      phone: '61999999999',
      profileType: 'client',
      street: '',
      number: '',
      complement: '',
      bairro: '',
      city: '',
      state: '',
      cep: '',
    });

    expect(createDraftMock).toHaveBeenCalledWith(expect.objectContaining({
      street: undefined,
      number: undefined,
      complement: undefined,
      bairro: undefined,
      city: undefined,
      state: undefined,
      cep: undefined,
    }));
  });

  it('rejeita cep inválido informado', async () => {
    queryMock.mockResolvedValueOnce([[]]);
    findOpenDraftByEmailMock.mockResolvedValueOnce(null);

    await expect(
      createRegistrationDraft({
        email: 'erro@dominio.com',
        name: 'Usuario',
        password: 'Senha123',
        phone: '61999999999',
        profileType: 'client',
        cep: '123',
      }),
    ).rejects.toMatchObject({
      code: 'DRAFT_ADDRESS_INVALID',
      statusCode: 400,
    });

    expect(createDraftMock).not.toHaveBeenCalled();
    expect(discardExpiredDraftsMock).toHaveBeenCalledTimes(1);
  });
});
