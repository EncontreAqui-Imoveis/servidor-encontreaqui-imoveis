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

describe('POST /auth/register/draft e PATCH /auth/register/draft/:draftId', () => {
  let app: express.Express;

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    const { default: authRoutes } = await import('../../src/routes/auth.routes');

    app = express();
    app.use(express.json());
    app.use('/auth', authRoutes);
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejeita cadastro de draft com email duplicado', async () => {
    serviceMocks.createRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(409, 'EMAIL_ALREADY_EXISTS', 'Este email ja esta em uso.'),
    );

    const response = await request(app).post('/auth/register/draft').send({
      email: 'duplicado@dominio.com',
      name: 'Usuario',
      password: 'Senha123',
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('EMAIL_ALREADY_EXISTS');
    expect(response.body.error).toBe('Este email ja esta em uso.');
  });

  it('aceita criação de draft com payload mínimo válido', async () => {
    serviceMocks.createRegistrationDraftMock.mockResolvedValue({
      draftId: 'draft-abc',
      draftToken: 'tok',
      draft: {
        draftId: 'draft-abc',
        profileType: 'client',
        email: 'novo@dominio.com',
        name: 'Usuario',
        status: 'OPEN',
        currentStep: 'IDENTITY',
      },
      expiresAtMinutes: 1440,
    });

    const response = await request(app).post('/auth/register/draft').send({
      email: 'novo@dominio.com',
      name: 'Usuario',
      phone: '61999999999',
      profileType: 'client',
      password: 'Senha123',
    });

    expect(response.status).toBe(201);
    expect(response.body.draftId).toBe('draft-abc');
    expect(response.body.draft.token).toBeUndefined();
    expect(response.body.draft.profileType).toBe('client');
    expect(response.body.expiresAtMinutes).toBe(1440);
  });

  it('retorna draftId com tamanho compatível com schema', async () => {
    serviceMocks.createRegistrationDraftMock.mockResolvedValue({
      draftId: '11111111-1111-4111-8111-111111111111',
      draftToken: 'tok',
      draft: {
        draftId: '11111111-1111-4111-8111-111111111111',
        profileType: 'client',
        email: 'novo@dominio.com',
        name: 'Usuario',
        status: 'OPEN',
        currentStep: 'IDENTITY',
      },
      expiresAtMinutes: 1440,
    });

    const response = await request(app).post('/auth/register/draft').send({
      email: 'novo@dominio.com',
      name: 'Usuario',
      phone: '61999999999',
      profileType: 'client',
      password: 'Senha123',
    });

    expect(response.status).toBe(201);
    expect(response.body.draftId).toHaveLength(36);
    expect(response.body.draftId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('aceita criação de draft com campos de endereço vazios', async () => {
    serviceMocks.createRegistrationDraftMock.mockResolvedValue({
      draftId: 'draft-empty-address',
      draftToken: 'tok',
      draft: {
        draftId: 'draft-empty-address',
        profileType: 'client',
        email: 'semendereco@dominio.com',
        name: 'Usuario',
        status: 'OPEN',
        currentStep: 'IDENTITY',
      },
      expiresAtMinutes: 1440,
    });

    const response = await request(app).post('/auth/register/draft').send({
      email: 'semendereco@dominio.com',
      name: 'Usuario',
      password: 'Senha123',
      profileType: 'client',
      phone: '61999999999',
      street: '',
      number: '',
      complement: '',
      bairro: '',
      city: '',
      state: '',
      cep: '',
    });

    expect(response.status).toBe(201);
    expect(response.body.draftId).toBe('draft-empty-address');
  });

  it('rejeita criação de draft com cep inválido informado', async () => {
    serviceMocks.createRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(400, 'DRAFT_ADDRESS_INVALID', 'Endereco invalido.'),
    );

    const response = await request(app).post('/auth/register/draft').send({
      email: 'erro@dominio.com',
      name: 'Usuario',
      password: 'Senha123',
      profileType: 'client',
      phone: '61999999999',
      cep: '123',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_ADDRESS_INVALID');
  });

  it('atualiza rascunho com cabeçalho de fluxo válido', async () => {
    serviceMocks.patchRegistrationDraftMock.mockResolvedValue({
      draftId: 'draft-abc',
      profileType: 'client',
      email: 'novo@dominio.com',
      name: 'Usuario Atualizado',
      status: 'OPEN',
      currentStep: 'CONTACT',
    });

    const response = await request(app)
      .patch('/auth/register/draft/draft-abc')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({
        name: 'Usuario Atualizado',
        currentStep: 'CONTACT',
      });

    expect(response.status).toBe(200);
    expect(response.body.draft.currentStep).toBe('CONTACT');
    expect(serviceMocks.patchRegistrationDraftMock).toHaveBeenCalledWith(
      'draft-abc',
      'tok',
      expect.objectContaining({ name: 'Usuario Atualizado', currentStep: 'CONTACT' }),
    );
  });

  it('rejeita atualização de endereço com cep inválido', async () => {
    serviceMocks.patchRegistrationDraftMock.mockRejectedValue(
      new DraftFlowErrorMock(400, 'DRAFT_ADDRESS_INVALID', 'Endereco invalido.'),
    );

    const response = await request(app)
      .patch('/auth/register/draft/draft-abc')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({
        street: 'Rua Exemplo',
        number: '123',
        bairro: 'Centro',
        city: 'Cidade',
        state: 'GO',
        cep: '123',
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRAFT_ADDRESS_INVALID');
  });
});
