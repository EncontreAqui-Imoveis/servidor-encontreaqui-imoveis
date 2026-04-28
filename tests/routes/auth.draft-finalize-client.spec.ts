import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  createRegistrationDraftMock: vi.fn(),
  patchRegistrationDraftMock: vi.fn(),
  getRegistrationDraftMock: vi.fn(),
  sendDraftEmailVerificationCodeMock: vi.fn(),
  confirmDraftEmailCodeMock: vi.fn(),
  requestDraftPhoneOtpMock: vi.fn(),
  confirmDraftPhoneOtpMock: vi.fn(),
  persistDraftDocumentsMock: vi.fn(),
  finalizeRegistrationDraftMock: vi.fn(),
  discardRegistrationDraftMock: vi.fn(),
}));

class DraftFlowErrorMock extends Error {
  statusCode: number;
  code: string;
  retryAfterSeconds?: number;

  constructor(statusCode: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

vi.mock('../../src/services/registrationDraftService', () => ({
  DraftFlowError: DraftFlowErrorMock,
  createRegistrationDraft: serviceMocks.createRegistrationDraftMock,
  patchRegistrationDraft: serviceMocks.patchRegistrationDraftMock,
  getRegistrationDraft: serviceMocks.getRegistrationDraftMock,
  sendDraftEmailVerificationCode: serviceMocks.sendDraftEmailVerificationCodeMock,
  confirmDraftEmailCode: serviceMocks.confirmDraftEmailCodeMock,
  requestDraftPhoneOtp: serviceMocks.requestDraftPhoneOtpMock,
  confirmDraftPhoneOtp: serviceMocks.confirmDraftPhoneOtpMock,
  persistDraftDocuments: serviceMocks.persistDraftDocumentsMock,
  finalizeRegistrationDraft: serviceMocks.finalizeRegistrationDraftMock,
  discardRegistrationDraft: serviceMocks.discardRegistrationDraftMock,
}));

describe('Finalização de rascunho para cliente', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');

    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  }, 60000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finaliza cliente com sucesso e retorna token', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-client',
      user: { id: 10, email: 'cliente@dominio.com', name: 'Cliente', role: 'client' },
      needsCompletion: false,
      requiresDocuments: false,
      action: 'submit_documents',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe('jwt-client');
    expect(response.body.user.role).toBe('client');
    expect(response.body.requiresDocuments).toBe(false);
  });

  it('rejeita cliente sem aceitação dos termos', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(400, 'TERMS_ACCEPTANCE_REQUIRED', 'Aceite dos termos de uso e obrigatorio.'),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: false,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
  });

  it('aceita action client_finalize como submit_documents', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-client-clientfinalize',
      user: { id: 10, email: 'cliente@dominio.com', name: 'Cliente', role: 'client' },
      needsCompletion: false,
      requiresDocuments: false,
      action: 'submit_documents',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'client_finalize',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(serviceMocks.finalizeRegistrationDraftMock).toHaveBeenCalledWith(
      'draft-client',
      'tok',
      'submit_documents',
      expect.objectContaining({
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      }),
      expect.any(Object),
    );
  });

  it('rejeita action inválida no finalize do cliente', async () => {
    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'client_unknown',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_INVALID_ACTION');
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });

  it('rejeita cliente sem aceitação da política de privacidade', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(
        400,
        'PRIVACY_ACCEPTANCE_REQUIRED',
        'Aceite da politica de privacidade e obrigatorio.',
      ),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: false,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PRIVACY_ACCEPTANCE_REQUIRED');
  });

  it('retorna erro quando senha obrigatória não foi informada', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(400, 'DRAFT_PASSWORD_REQUIRED', 'Senha nao informada para cliente.'),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_PASSWORD_REQUIRED');
  });

  it('finaliza cliente sem cep com endereço manual completo já informado', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-client-sem-cep',
      user: {
        id: 12,
        email: 'cliente-sem-cep@dominio.com',
        name: 'Cliente Sem Cep',
        role: 'client',
        street: 'Rua 1',
        number: '10',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: false,
      action: 'submit_documents',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.needsCompletion).toBe(false);
    expect(response.body.user.cep).toBeNull();
    expect(response.body.requiresDocuments).toBe(false);
  });

  it('finaliza cliente sem phoneVerifiedAt no rascunho', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-client-phone-opcional',
      user: {
        id: 13,
        email: 'cliente-sem-fone@dominio.com',
        name: 'Cliente Sem Telefone',
        role: 'client',
        phone: null,
        street: 'Rua 2',
        number: '20',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: false,
      action: 'submit_documents',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-client/finalize')
      .set('x-draft-id', 'draft-client')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe('jwt-client-phone-opcional');
    expect(response.body.user.phone).toBeNull();
  });
});
