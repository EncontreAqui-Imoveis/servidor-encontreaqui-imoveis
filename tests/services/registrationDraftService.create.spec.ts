import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'dotenv/config';

const {
  queryMock,
  createDraftMock,
  discardExpiredDraftsMock,
  findOpenDraftByEmailMock,
  getDraftByDraftIdAndTokenMock,
  updateDraftByDraftIdMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createDraftMock: vi.fn(),
  discardExpiredDraftsMock: vi.fn(),
  findOpenDraftByEmailMock: vi.fn(),
  getDraftByDraftIdAndTokenMock: vi.fn(),
  updateDraftByDraftIdMock: vi.fn(),
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
    getDraftByDraftIdAndToken: getDraftByDraftIdAndTokenMock,
    updateDraftByDraftId: updateDraftByDraftIdMock,
  };
});

import { createRegistrationDraft, patchRegistrationDraft } from '../../src/services/registrationDraftService';

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
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    created_at: new Date(),
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

  it('aceita PATCH de rascunho com payload parcial sem endereço', async () => {
    const draft = buildDraftRow();
    getDraftByDraftIdAndTokenMock
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, name: 'Nome Atualizado' });

    const response = await patchRegistrationDraft('draft-abc', 'tok', {
      name: 'Nome Atualizado',
    });

    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-abc',
      expect.any(String),
      expect.objectContaining({ name: 'Nome Atualizado' }),
    );
    expect(getDraftByDraftIdAndTokenMock).toHaveBeenCalledTimes(2);
    expect(getDraftByDraftIdAndTokenMock).toHaveBeenNthCalledWith(1, 'draft-abc', expect.any(String));
    expect(response.name).toBe('Nome Atualizado');
  });

  it('aceita PATCH com campos de endereço vazios (ignorados)', async () => {
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(buildDraftRow());

    const response = await patchRegistrationDraft('draft-abc', 'tok', {
      street: '',
      number: '',
      complement: '',
      bairro: '',
      city: '',
      state: '',
      cep: '',
    });

    expect(updateDraftByDraftIdMock).not.toHaveBeenCalled();
    expect(response.name).toBe('Usuario');
  });

  it('aceita PATCH com endereço completo sem CEP', async () => {
    const draft = buildDraftRow();
    getDraftByDraftIdAndTokenMock
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        street: 'Rua X',
        number: '100',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      });

    await patchRegistrationDraft('draft-abc', 'tok', {
      street: 'Rua X',
      number: '100',
      bairro: 'Centro',
      city: 'Cidade',
      state: 'GO',
    });

    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-abc',
      expect.any(String),
      expect.objectContaining({
        street: 'Rua X',
        number: '100',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
      }),
    );
  });

  it('aceita PATCH com endereço completo com CEP válido', async () => {
    const draft = buildDraftRow();
    getDraftByDraftIdAndTokenMock
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({
        ...draft,
        street: 'Rua X',
        number: '100',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: '79878979',
      });

    await patchRegistrationDraft('draft-abc', 'tok', {
      street: 'Rua X',
      number: '100',
      bairro: 'Centro',
      city: 'Cidade',
      state: 'GO',
      cep: '79878979',
    });

    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-abc',
      expect.any(String),
      expect.objectContaining({ cep: '79878979' }),
    );
  });

  it('rejeita PATCH com CEP inválido informado e retorna campo com erro', async () => {
    const draft = buildDraftRow();
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(draft);

    await expect(
      patchRegistrationDraft('draft-abc', 'tok', {
        street: 'Rua X',
        number: '100',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: '123',
      }),
    ).rejects.toMatchObject({
      code: 'DRAFT_ADDRESS_INVALID',
      statusCode: 400,
      fields: ['cep'],
    });

    expect(updateDraftByDraftIdMock).not.toHaveBeenCalled();
  });

  it('aceita PATCH com "S/N" e sem número', async () => {
    const draft = buildDraftRow();
    getDraftByDraftIdAndTokenMock
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, number: 'S/N' });

    await patchRegistrationDraft('draft-abc', 'tok', {
      number: 'S/N',
      street: 'Rua Sem Numero',
      bairro: 'Centro',
      city: 'Cidade',
      state: 'GO',
    });

    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-abc',
      expect.any(String),
      expect.objectContaining({
        number: 'S/N',
        withoutNumber: true,
      }),
    );
  });

  it('aceita PATCH com withoutNumber=true', async () => {
    const draft = buildDraftRow();
    getDraftByDraftIdAndTokenMock
      .mockResolvedValueOnce(draft)
      .mockResolvedValueOnce({ ...draft, number: 'S/N' });

    await patchRegistrationDraft('draft-abc', 'tok', {
      withoutNumber: true,
      street: 'Rua Sem Numero',
      bairro: 'Centro',
      city: 'Cidade',
      number: '10',
      state: 'GO',
    });

    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-abc',
      expect.any(String),
      expect.objectContaining({
        withoutNumber: true,
      }),
    );
  });
});
