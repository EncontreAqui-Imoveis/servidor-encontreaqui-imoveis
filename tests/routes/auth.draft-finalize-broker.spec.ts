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
const cloudinaryMocks = vi.hoisted(() => ({
  uploadToCloudinaryMock: vi.fn(),
  deleteCloudinaryAssetMock: vi.fn(),
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
vi.mock('../../src/config/cloudinary', () => ({
  uploadToCloudinary: cloudinaryMocks.uploadToCloudinaryMock,
  deleteCloudinaryAsset: cloudinaryMocks.deleteCloudinaryAssetMock,
}));

describe('Finalização de rascunho para corretor', () => {
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
    cloudinaryMocks.uploadToCloudinaryMock.mockResolvedValue({
      url: 'https://cdn.example.com/uploaded.png',
    });
    cloudinaryMocks.deleteCloudinaryAssetMock.mockResolvedValue(undefined);
  });

  it('finaliza corretor com ação send_later', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-broker',
      user: {
        id: 11,
        email: 'corretor@dominio.com',
        name: 'Corretor',
        role: 'broker',
        street: 'Rua Corretor',
        number: '100',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: true,
      action: 'send_later',
      underReview: false,
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'send_later',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.requiresDocuments).toBe(true);
    expect(response.body.needsCompletion).toBe(false);
    expect(response.body.action).toBe('send_later');
    expect(response.body.underReview).toBe(false);
  });

  it('aceita broker_send_later como alias de send_later', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-broker-alias',
      user: {
        id: 14,
        email: 'corretor-alias@dominio.com',
        name: 'Corretor Alias',
        role: 'broker',
        street: 'Rua Corretor',
        number: '100',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: true,
      action: 'send_later',
      underReview: false,
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'broker_send_later',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.underReview).toBe(false);
    expect(serviceMocks.finalizeRegistrationDraftMock).toHaveBeenCalledWith(
      'draft-broker',
      'tok',
      'send_later',
      expect.objectContaining({
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
      }),
      expect.any(Object),
    );
  });

  it('finaliza corretor por submit_documents sem cep com endereço manual completo', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-broker-submit',
      user: {
        id: 12,
        email: 'corretor-submit@dominio.com',
        name: 'Corretor Submit',
        role: 'broker',
        street: 'Rua Corretor',
        number: '200',
        bairro: 'Bairro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: true,
      action: 'submit_documents',
      underReview: true,
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.action).toBe('submit_documents');
    expect(response.body.user.cep).toBeNull();
    expect(response.body.requiresDocuments).toBe(true);
    expect(response.body.underReview).toBe(true);
  });

  it('aceita broker_submit_documents como alias de submit_documents', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-broker-submit-alias',
      user: {
        id: 15,
        email: 'corretor-submit-alias@dominio.com',
        name: 'Corretor Submit Alias',
        role: 'broker',
        street: 'Rua Corretor',
        number: '200',
        bairro: 'Bairro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: true,
      action: 'submit_documents',
      underReview: true,
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'broker_submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.underReview).toBe(true);
    expect(serviceMocks.finalizeRegistrationDraftMock).toHaveBeenCalledWith(
      'draft-broker',
      'tok',
      'submit_documents',
      expect.objectContaining({
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
      }),
      expect.any(Object),
    );
  });

  it('finaliza corretor sem phoneVerifiedAt no rascunho', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockResolvedValue({
      token: 'jwt-broker-phone-opcional',
      user: {
        id: 13,
        email: 'corretor-sem-fone@dominio.com',
        name: 'Corretor Sem Telefone',
        role: 'broker',
        phone: null,
        street: 'Rua 2',
        number: '20',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: null,
      },
      needsCompletion: false,
      requiresDocuments: true,
      action: 'send_later',
      underReview: false,
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'send_later',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(200);
    expect(response.body.token).toBe('jwt-broker-phone-opcional');
    expect(response.body.requiresDocuments).toBe(true);
    expect(response.body.user.phone).toBeNull();
    expect(response.body.underReview).toBe(false);
  });

  it('rejeita corretor que encerra com action submit_documents sem docs', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(
        400,
        'DRAFT_DOCUMENTS_MISSING',
        'Documentos de corretor sao obrigatorios.',
      ),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_DOCUMENTS_MISSING');
  });

  it('rejeita action inválida no finalize do broker', async () => {
    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'broker_invalid',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: true,
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_INVALID_ACTION');
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });

  it('rejeita corretor send_later sem termo de adesão', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(
        400,
        'BROKER_AGREEMENT_REQUIRED',
        'Aceite do contrato de adesso de corretor e obrigatorio.',
      ),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'send_later',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: false,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BROKER_AGREEMENT_REQUIRED');
  });

  it('rejeita corretor submit_documents sem termo de adesão', async () => {
    serviceMocks.finalizeRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(
        400,
        'BROKER_AGREEMENT_REQUIRED',
        'Aceite do contrato de adesso de corretor e obrigatorio.',
      ),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/finalize')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .send({
        action: 'submit_documents',
        acceptedTerms: true,
        acceptedPrivacyPolicy: true,
        acceptedBrokerAgreement: false,
        termsVersion: '2026-04-28',
        privacyPolicyVersion: '2026-04-28',
        brokerAgreementVersion: '2026-04-28',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('BROKER_AGREEMENT_REQUIRED');
  });

  it('rejeita upload com tipo de arquivo inválido em submit-documents', async () => {
    const response = await request(app)
      .post('/auth/register/draft/draft-broker/submit-documents')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .attach('creciFront', Buffer.from('texto'), 'creci.docx')
      .attach('creciBack', Buffer.from('imagem'), 'creci-back.png')
      .attach('selfie', Buffer.from('imagem'), 'selfie.png');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_DOCUMENTS_INVALID');
    expect(serviceMocks.persistDraftDocumentsMock).not.toHaveBeenCalled();
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });

  it('rejeita arquivo acima do limite permitido em submit-documents', async () => {
    const hugeBuffer = Buffer.alloc(6 * 1024 * 1024, 1);

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/submit-documents')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .attach('creciFront', hugeBuffer, 'creci-front.png')
      .attach('creciBack', Buffer.from('ok'), 'creci-back.png')
      .attach('selfie', Buffer.from('ok'), 'selfie.png');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_DOCUMENTS_INVALID');
    expect(serviceMocks.persistDraftDocumentsMock).not.toHaveBeenCalled();
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });

  it('rejeita submit-documents sem todos os campos obrigatórios', async () => {
    const response = await request(app)
      .post('/auth/register/draft/draft-broker/submit-documents')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .attach('creciFront', Buffer.from('imagem'), 'creci-front.png')
      .attach('creciBack', Buffer.from('imagem'), 'creci-back.png');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_DOCUMENTS_REQUIRED');
    expect(serviceMocks.persistDraftDocumentsMock).not.toHaveBeenCalled();
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });

  it('rejeita quantidade acima do permitido por campo em submit-documents', async () => {
    const response = await request(app)
      .post('/auth/register/draft/draft-broker/submit-documents')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .attach('creciFront', Buffer.from('imagem'), 'creci-front-1.png')
      .attach('creciFront', Buffer.from('imagem'), 'creci-front-2.png')
      .attach('creciBack', Buffer.from('imagem'), 'creci-back.png')
      .attach('selfie', Buffer.from('imagem'), 'selfie.png');

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_DOCUMENTS_INVALID');
    expect(serviceMocks.persistDraftDocumentsMock).not.toHaveBeenCalled();
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });

  it('faz cleanup se storage falhar durante submit-documents', async () => {
    cloudinaryMocks.uploadToCloudinaryMock
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/creci-front.png' })
      .mockRejectedValueOnce(new Error('falha simulada de storage'))
      .mockResolvedValueOnce({ url: 'https://cdn.example.com/selfie.png' });
    cloudinaryMocks.deleteCloudinaryAssetMock.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/auth/register/draft/draft-broker/submit-documents')
      .set('x-draft-id', 'draft-broker')
      .set('x-draft-token', 'tok')
      .attach('creciFront', Buffer.from('imagem'), 'creci-front.png')
      .attach('creciBack', Buffer.from('imagem'), 'creci-back.png')
      .attach('selfie', Buffer.from('imagem'), 'selfie.png');

    expect(response.status).toBe(502);
    expect(response.body.code).toBe('DRAFT_DOCUMENTS_STORAGE_FAILED');
    expect(cloudinaryMocks.deleteCloudinaryAssetMock).toHaveBeenCalledWith({
      url: 'https://cdn.example.com/creci-front.png',
    });
    expect(serviceMocks.persistDraftDocumentsMock).not.toHaveBeenCalled();
    expect(serviceMocks.finalizeRegistrationDraftMock).not.toHaveBeenCalled();
  });
});
