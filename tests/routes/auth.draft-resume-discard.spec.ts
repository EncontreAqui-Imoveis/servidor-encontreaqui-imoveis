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

describe('Retomar e descartar fluxo de rascunho', () => {
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

  it('retoma rascunho em aberto com sucesso', async () => {
    serviceMocks.getRegistrationDraftMock.mockResolvedValue({
      draftId: 'draft-resume',
      profileType: 'client',
      currentStep: 'ADDRESS',
      status: 'OPEN',
      needsEmailVerification: false,
      needsPhoneVerification: true,
    });

    const response = await request(app)
      .get('/auth/register/draft/draft-resume')
      .set('x-draft-id', 'draft-resume')
      .set('x-draft-token', 'tok');

    expect(response.status).toBe(200);
    expect(response.body.draft.currentStep).toBe('ADDRESS');
    expect(response.body.draft.status).toBe('OPEN');
  });

  it('descarta rascunho e retorna status DISCARDED', async () => {
    serviceMocks.discardRegistrationDraftMock.mockResolvedValue({
      draftId: 'draft-resume',
      status: 'DISCARDED',
    });

    const response = await request(app)
      .post('/auth/register/draft/draft-resume/discard')
      .set('x-draft-id', 'draft-resume')
      .set('x-draft-token', 'tok');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('DISCARDED');
    expect(serviceMocks.discardRegistrationDraftMock).toHaveBeenCalledWith('draft-resume', 'tok');
  });
});
