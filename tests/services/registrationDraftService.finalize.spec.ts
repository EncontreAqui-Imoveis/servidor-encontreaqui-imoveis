import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  authBeginTransactionMock,
  authCommitMock,
  authGetConnectionMock,
  authQueryMock,
  updateDraftByDraftIdMock,
  authReleaseMock,
  authRollbackMock,
  getDraftByDraftIdAndTokenMock,
} = vi.hoisted(() => ({
  authBeginTransactionMock: vi.fn(),
  authCommitMock: vi.fn(),
  authGetConnectionMock: vi.fn(),
  authQueryMock: vi.fn(),
  updateDraftByDraftIdMock: vi.fn(),
  authReleaseMock: vi.fn(),
  authRollbackMock: vi.fn(),
  getDraftByDraftIdAndTokenMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  authDb: {
    getConnection: authGetConnectionMock,
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

vi.mock('../../src/services/authSessionService', () => ({
  buildUserPayload: (user: {
    id: number;
    [key: string]: unknown;
  }) => ({ ...user, payloadTagged: true }),
  signUserToken: () => 'jwt-test',
  hasCompleteProfile: () => true,
}));

import { finalizeRegistrationDraft, patchRegistrationDraft } from '../../src/services/registrationDraftService';

function buildDraft(overrides: Record<string, unknown> = {}) {
  return {
    draft_id: 'draft-finalize',
    draft_token_hash: 'token-hash',
    status: 'OPEN',
    profile_type: 'client',
    email: 'cliente@dominio.com',
    email_normalized: 'cliente@dominio.com',
    name: 'Cliente',
    phone: '5511999999999',
    street: 'Rua X',
    number: '10',
    complement: null,
    bairro: 'Centro',
    city: 'Cidade',
    state: 'GO',
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
    password_hash: 'pwd-hash',
    password_hash_expires_at: new Date(Date.now() + 60 * 60 * 1000),
    current_step: 'VERIFICATION',
    revision: 1,
    expires_at: new Date(Date.now() + 60 * 60 * 1000),
    created_at: new Date(),
    updated_at: new Date(),
    completed_at: null,
    discarded_at: null,
    user_id: null,
    id: 3001,
    ...overrides,
  };
}

describe('finalizeRegistrationDraft', () => {
  const db = {
    beginTransaction: authBeginTransactionMock,
    commit: authCommitMock,
    query: authQueryMock,
    rollback: authRollbackMock,
    release: authReleaseMock,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    authGetConnectionMock.mockResolvedValue(db);
  });

  it('persiste aceite de termos e política no finalize do cliente', async () => {
    const lockedDraft = buildDraft();
    const userRow = {
      id: 101,
      name: lockedDraft.name,
      email: lockedDraft.email,
      email_verified_at: lockedDraft.email_verified_at,
      phone: lockedDraft.phone,
      street: lockedDraft.street,
      number: lockedDraft.number,
      complement: lockedDraft.complement,
      bairro: lockedDraft.bairro,
      city: lockedDraft.city,
      state: lockedDraft.state,
      cep: lockedDraft.cep,
      broker_id: null,
      broker_status: null,
      creci: null,
    };
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(lockedDraft);
    authQueryMock
      .mockResolvedValueOnce([[lockedDraft], []])
      .mockResolvedValueOnce([{ insertId: 101 }, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([ [userRow], [] ]);

    const result = await finalizeRegistrationDraft(
      'draft-finalize',
      'raw-token',
      'submit_documents',
      {
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      },
      { ip: '200.1.2.3', userAgent: 'mobile-agent' },
    );

    expect(result.token).toBe('jwt-test');
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_legal_acceptances'),
      [101, 'terms', '2026-04-28', expect.any(Date), '200.1.2.3', 'mobile-agent'],
    );
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_legal_acceptances'),
      [101, 'privacy', '2026-04-28', expect.any(Date), '200.1.2.3', 'mobile-agent'],
    );
  });

  it('persistência de aceite inclui termo de adesão para corretor send_later', async () => {
    const lockedDraft = buildDraft({
      profile_type: 'broker',
      creci: '123456',
      auth_provider: 'email',
      password_hash: null,
    });
    const userRow = {
      id: 202,
      name: lockedDraft.name,
      email: lockedDraft.email,
      email_verified_at: lockedDraft.email_verified_at,
      phone: lockedDraft.phone,
      street: lockedDraft.street,
      number: lockedDraft.number,
      complement: lockedDraft.complement,
      bairro: lockedDraft.bairro,
      city: lockedDraft.city,
      state: lockedDraft.state,
      cep: lockedDraft.cep,
      broker_id: 202,
      broker_status: 'pending_verification',
      creci: '123456',
    };
    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(lockedDraft);
    authQueryMock
      .mockResolvedValueOnce([[lockedDraft], []])
      .mockResolvedValueOnce([{ insertId: 202 }, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([ [userRow], [] ]);

    const result = await finalizeRegistrationDraft(
      'draft-finalize',
      'raw-token',
      'send_later',
      {
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      },
      { ip: '200.1.2.3', userAgent: 'mobile-agent' },
    );

    expect(result.requiresDocuments).toBe(true);
    expect(result.action).toBe('send_later');
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_legal_acceptances'),
      [202, 'terms', '2026-04-28', expect.any(Date), '200.1.2.3', 'mobile-agent'],
    );
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_legal_acceptances'),
      [202, 'privacy', '2026-04-28', expect.any(Date), '200.1.2.3', 'mobile-agent'],
    );
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_legal_acceptances'),
      [202, 'broker_agreement', '2026-04-28', expect.any(Date), '200.1.2.3', 'mobile-agent'],
    );
  });

  it('marca broker em send_later como pendente, sem enviar para análise', async () => {
    const lockedDraft = buildDraft({
      profile_type: 'broker',
      creci: '123456',
      auth_provider: 'email',
      password_hash: null,
    });
    const userRow = {
      id: 202,
      name: lockedDraft.name,
      email: lockedDraft.email,
      email_verified_at: lockedDraft.email_verified_at,
      phone: lockedDraft.phone,
      street: lockedDraft.street,
      number: lockedDraft.number,
      complement: lockedDraft.complement,
      bairro: lockedDraft.bairro,
      city: lockedDraft.city,
      state: lockedDraft.state,
      cep: lockedDraft.cep,
      broker_id: 202,
      broker_status: 'pending_verification',
      creci: '123456',
    };

    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(lockedDraft);
    authQueryMock.mockImplementation(async (query: string) => {
      if (query.includes('registration_drafts') && query.includes('FOR UPDATE')) {
        return [[lockedDraft], []];
      }
      if (query.includes('INSERT INTO users')) {
        return [{ insertId: 202 }, []];
      }
      if (query.includes('INSERT INTO user_legal_acceptances')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('INSERT INTO brokers')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('UPDATE registration_drafts')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('DELETE FROM registration_draft_documents')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('DELETE FROM registration_phone_otps')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('DELETE FROM email_code_challenges')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('FROM users u') && query.includes('LEFT JOIN brokers b')) {
        return [[userRow], []];
      }

      return [[], []];
    });

    const result = await finalizeRegistrationDraft(
      'draft-finalize',
      'raw-token',
      'send_later',
      {
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      },
      { ip: '200.1.2.3', userAgent: 'mobile-agent' },
    );

    expect(result.requiresDocuments).toBe(true);
    expect(result.underReview).toBe(false);
    expect(result.action).toBe('send_later');
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)'),
      [202, '123456', 'pending_verification'],
    );
    expect(authQueryMock).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents'),
      expect.any(Array),
    );
  });

  it('marca broker em submit_documents como em análise após salvar documentos', async () => {
    const lockedDraft = buildDraft({
      profile_type: 'broker',
      creci: '123456',
      auth_provider: 'email',
      password_hash: null,
    });
    const userRow = {
      id: 202,
      name: lockedDraft.name,
      email: lockedDraft.email,
      email_verified_at: lockedDraft.email_verified_at,
      phone: lockedDraft.phone,
      street: lockedDraft.street,
      number: lockedDraft.number,
      complement: lockedDraft.complement,
      bairro: lockedDraft.bairro,
      city: lockedDraft.city,
      state: lockedDraft.state,
      cep: lockedDraft.cep,
      broker_id: 202,
      broker_status: 'pending_verification',
      creci: '123456',
    };

    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(lockedDraft);
    authQueryMock.mockImplementation(async (query: string) => {
      if (query.includes('registration_drafts') && query.includes('FOR UPDATE')) {
        return [[lockedDraft], []];
      }
      if (query.includes('INSERT INTO users')) {
        return [{ insertId: 202 }, []];
      }
      if (query.includes('INSERT INTO user_legal_acceptances')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('INSERT INTO brokers')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('SELECT creci_front_url, creci_back_url, selfie_url')) {
        return [
          [{ id: 1, creci_front_url: 'front', creci_back_url: 'back', selfie_url: 'selfie' }],
          [],
        ];
      }
      if (query.includes('INSERT INTO broker_documents')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('UPDATE registration_drafts')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('DELETE FROM registration_draft_documents')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('DELETE FROM registration_phone_otps')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('DELETE FROM email_code_challenges')) {
        return [{ affectedRows: 1 }, []];
      }
      if (query.includes('FROM users u') && query.includes('LEFT JOIN brokers b')) {
        return [[userRow], []];
      }
      return [[], []];
    });

    const result = await finalizeRegistrationDraft(
      'draft-finalize',
      'raw-token',
      'submit_documents',
      {
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      },
      { ip: '200.1.2.3', userAgent: 'mobile-agent' },
    );

    expect(result.requiresDocuments).toBe(true);
    expect(result.underReview).toBe(true);
    expect(result.action).toBe('submit_documents');
    expect(authQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO broker_documents'),
      [202, 'front', 'back', 'selfie', 'pending'],
    );
  });

  it('permite correção do CRECI antes da finalização via patch', async () => {
    const lockedDraft = buildDraft({
      profile_type: 'broker',
      creci: '123456',
      auth_provider: 'email',
      password_hash: null,
    });
    const patchedDraft = { ...lockedDraft, creci: '654321' };

    getDraftByDraftIdAndTokenMock
      .mockResolvedValueOnce(lockedDraft)
      .mockResolvedValueOnce(patchedDraft);
    updateDraftByDraftIdMock.mockResolvedValue(undefined);
    authQueryMock
      .mockResolvedValueOnce([[lockedDraft], []])
      .mockResolvedValueOnce([[patchedDraft], []]);

    const response = await patchRegistrationDraft(
      'draft-finalize',
      'raw-token',
      { creci: '654321' },
    );

    expect(response.creci).toBe('654321');
    expect(updateDraftByDraftIdMock).toHaveBeenCalledWith(
      'draft-finalize',
      expect.any(String),
      { creci: '654321' },
    );
  });

  it('rejeita correção de CRECI inválido antes da finalização', async () => {
    const lockedDraft = buildDraft({
      profile_type: 'broker',
      creci: '123456',
      auth_provider: 'email',
      password_hash: null,
    });

    getDraftByDraftIdAndTokenMock.mockResolvedValueOnce(lockedDraft);
    authQueryMock.mockResolvedValueOnce([[lockedDraft], []]);

    await expect(
      patchRegistrationDraft(
        'draft-finalize',
        'raw-token',
        { creci: 'inv' },
      ),
    ).rejects.toMatchObject({
      code: 'DRAFT_CRICI_INVALID',
    });

    expect(updateDraftByDraftIdMock).not.toHaveBeenCalled();
    expect(authQueryMock).toHaveBeenCalledTimes(0);
  });
});
