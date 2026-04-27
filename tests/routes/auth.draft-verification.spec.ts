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

describe('Verificações em /auth/register/draft', () => {
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

  it('envia código de e-mail para verificação de draft', async () => {
    serviceMocks.sendDraftEmailVerificationCodeMock.mockResolvedValue({
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      cooldownSec: 60,
      retryAfterSeconds: 60,
      resendType: 'sent',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-email')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.cooldownSec).toBe(60);
    expect(serviceMocks.sendDraftEmailVerificationCodeMock).toHaveBeenCalledWith('draft-abc', 'tok');
  });

  it('envia reenvio inicial e resend de e-mail de verificação de draft sem emitir JWT', async () => {
    serviceMocks.sendDraftEmailVerificationCodeMock
      .mockResolvedValueOnce({
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        cooldownSec: 60,
        retryAfterSeconds: 60,
        resendType: 'initial',
      })
      .mockResolvedValueOnce({
        sentAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        cooldownSec: 60,
        retryAfterSeconds: 60,
        resendType: 'resend',
      });

    const initial = await request(app)
      .post('/auth/register/draft/draft-abc/verify-email')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({});

    const resend = await request(app)
      .post('/auth/register/draft/draft-abc/verify-email')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({});

    expect(initial.status).toBe(200);
    expect(initial.body.resendType).toBe('initial');
    expect(resend.status).toBe(200);
    expect(resend.body.resendType).toBe('resend');
    expect(initial.body).not.toHaveProperty('token');
    expect(resend.body).not.toHaveProperty('token');
    expect(serviceMocks.sendDraftEmailVerificationCodeMock).toHaveBeenCalledTimes(2);
  });

  it('mapeia falha no challenge sem expor erro interno genérico', async () => {
    serviceMocks.sendDraftEmailVerificationCodeMock.mockRejectedValueOnce(
      new DraftFlowErrorMock(
        503,
        'EMAIL_CODE_CHALLENGE_FAILED',
        'Falha temporaria ao enviar o codigo de verificacao.',
      ),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-email')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({});

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('EMAIL_CODE_CHALLENGE_FAILED');
  });

  it('confirma código inválido de e-mail e retorna erro', async () => {
    serviceMocks.confirmDraftEmailCodeMock.mockRejectedValue(
      new DraftFlowErrorMock(400, 'EMAIL_CODE_INVALID', 'Codigo invalido.'),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-email/confirm')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({ code: '123456' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('EMAIL_CODE_INVALID');
    expect(response.body.error).toBe('Codigo invalido.');
  });

  it('confirma código válido sem emitir JWT/usuário', async () => {
    serviceMocks.confirmDraftEmailCodeMock.mockResolvedValue({
      status: 'verified',
      verifiedAt: new Date().toISOString(),
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-email/confirm')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({ code: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('verified');
    expect(response.body.verifiedAt).toBeDefined();
    expect(response.body).not.toHaveProperty('token');
    expect(response.body).not.toHaveProperty('user');
  });

  it('envia OTP de telefone e retorna sessionToken', async () => {
    serviceMocks.requestDraftPhoneOtpMock.mockResolvedValue({
      sessionToken: 'session-123',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-phone')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({ phone: '62999998888' });

    expect(response.status).toBe(200);
    expect(response.body.sessionToken).toBe('session-123');
  });

  it('confirma OTP de telefone ausente e retorna 404', async () => {
    serviceMocks.confirmDraftPhoneOtpMock.mockRejectedValue(
      new DraftFlowErrorMock(404, 'PHONE_SESSION_NOT_FOUND', 'Sessao de verificacao nao encontrada.'),
    );

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-phone/confirm')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({ sessionToken: 'missing', code: '123456' });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('PHONE_SESSION_NOT_FOUND');
  });

  it('solicita verificação por telefone em modo firebase', async () => {
    serviceMocks.requestDraftPhoneOtpMock.mockResolvedValue({
      mode: 'firebase',
      requiresFirebaseIdToken: true,
      phone: '5511999999999',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-phone')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({ phone: '5511999999999' });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('firebase');
    expect(response.body.requiresFirebaseIdToken).toBe(true);
    expect(response.body.phone).toBe('5511999999999');
    expect(response.body).not.toHaveProperty('sessionToken');
  });

  it('confirma telefone com Firebase token sem retorno de usuário/JWT', async () => {
    serviceMocks.confirmDraftPhoneOtpMock.mockResolvedValue({
      status: 'verified',
      phone: '5511999999999',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-abc/verify-phone/confirm')
      .set('x-draft-id', 'draft-abc')
      .set('x-draft-token', 'tok')
      .send({ firebaseIdToken: 'firebase-id-token' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('verified');
    expect(response.body.phone).toBe('5511999999999');
    expect(response.body).not.toHaveProperty('token');
    expect(response.body).not.toHaveProperty('user');
    expect(serviceMocks.confirmDraftPhoneOtpMock).toHaveBeenCalledWith(
      'draft-abc',
      'tok',
      undefined,
      undefined,
      'firebase-id-token',
    );
  });
});
