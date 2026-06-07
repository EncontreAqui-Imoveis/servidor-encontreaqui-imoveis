import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  GoneError,
  InvalidInputError,
  LockedError,
  NotFoundError,
  TooManyRequestsError,
  UnavailableError,
} from '../../src/errors/ApplicationError';

const {
  queryMock,
  requestOtpMock,
  resendOtpMock,
  verifyOtpMock,
  issueEmailCodeChallengeMock,
  deleteEmailCodeChallengeMock,
  getEmailVerificationStatusMock,
  verifyEmailCodeMock,
  verifyPasswordResetCodeMock,
  confirmPasswordResetMock,
  sendEmailCodeEmailMock,
  hashMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  requestOtpMock: vi.fn(),
  resendOtpMock: vi.fn(),
  verifyOtpMock: vi.fn(),
  issueEmailCodeChallengeMock: vi.fn(),
  deleteEmailCodeChallengeMock: vi.fn(),
  getEmailVerificationStatusMock: vi.fn(),
  verifyEmailCodeMock: vi.fn(),
  verifyPasswordResetCodeMock: vi.fn(),
  confirmPasswordResetMock: vi.fn(),
  sendEmailCodeEmailMock: vi.fn(),
  hashMock: vi.fn(),
}));

vi.mock('../../src/services/authPersistenceService', () => ({
  __esModule: true,
  authDb: {
    query: queryMock,
  },
}));

vi.mock('../../src/services/phoneOtpService', () => ({
  phoneOtpService: {
    requestOtp: requestOtpMock,
    resendOtp: resendOtpMock,
    verifyOtp: verifyOtpMock,
  },
}));

vi.mock('../../src/services/emailCodeChallengeService', () => ({
  issueEmailCodeChallenge: issueEmailCodeChallengeMock,
  deleteEmailCodeChallenge: deleteEmailCodeChallengeMock,
  getEmailVerificationStatus: getEmailVerificationStatusMock,
  verifyEmailCode: verifyEmailCodeMock,
  verifyPasswordResetCode: verifyPasswordResetCodeMock,
  confirmPasswordReset: confirmPasswordResetMock,
}));

vi.mock('../../src/services/emailService', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/emailService')>(
    '../../src/services/emailService',
  );
  return {
    ...actual,
    sendEmailCodeEmail: sendEmailCodeEmailMock,
  };
});

vi.mock('bcryptjs', () => ({
  default: {
    hash: hashMock,
  },
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-auth-verification-secret';
});

beforeEach(() => {
  vi.clearAllMocks();
  requestOtpMock.mockReturnValue({
    sessionToken: 'otp-session',
    expiresAt: new Date('2026-03-06T10:00:00.000Z'),
    code: '123456',
  });
  resendOtpMock.mockReturnValue({
    sessionToken: 'otp-session',
    expiresAt: new Date('2026-03-06T10:00:00.000Z'),
    code: '123456',
  });
  verifyOtpMock.mockReturnValue({ ok: true });
  getEmailVerificationStatusMock.mockResolvedValue({
    status: 'pending',
    expiresAt: new Date('2026-03-06T10:20:00.000Z'),
  });
  issueEmailCodeChallengeMock.mockResolvedValue({
    allowed: true,
    requestId: 7,
    code: '654321',
    attemptNumber: 1,
    expiresAt: new Date('2026-03-06T10:15:00.000Z'),
    cooldownSec: 60,
    dailyRemaining: 4,
    resendType: 'initial',
  });
  verifyEmailCodeMock.mockResolvedValue({
    status: 'verified',
    verifiedAt: new Date('2026-03-06T10:20:00.000Z'),
  });
  verifyPasswordResetCodeMock.mockResolvedValue({
    status: 'verified',
    resetSessionToken: 'reset-session',
    expiresAt: new Date('2026-03-06T10:30:00.000Z'),
  });
  confirmPasswordResetMock.mockResolvedValue({
    status: 'consumed',
    consumedAt: new Date('2026-03-06T10:40:00.000Z'),
  });
  sendEmailCodeEmailMock.mockResolvedValue(undefined);
  hashMock.mockResolvedValue('hashed-password');
});

describe('authVerificationService', () => {
  it('handles OTP request/resend/verify', async () => {
    const { requestOtp, resendOtp, verifyOtp } = await import('../../src/services/authVerificationService');

    expect(() => requestOtp({ phone: '123' })).toThrow(InvalidInputError);

    const requestResult = requestOtp({ phone: '(62) 99999-8888' });
    expect(requestResult.otpCode).toBe('123456');
    expect(requestOtpMock).toHaveBeenCalledWith('62999998888');

    expect(() => resendOtp({})).toThrow(InvalidInputError);

    const resendResult = resendOtp({ sessionToken: 'otp-session' });
    expect(resendResult.sessionToken).toBe('otp-session');

    expect(verifyOtp({ sessionToken: 'otp-session', code: '123456' })).toEqual({ ok: true });
    expect(() => verifyOtp({ sessionToken: 'otp-session', code: '123' })).toThrow(
      InvalidInputError,
    );
  });

  it('handles email verification and password reset flows', async () => {
    const {
      sendEmailVerification,
      checkEmailVerification,
      verifyEmailVerificationCode,
      requestPasswordReset,
      verifyPasswordResetCode,
      confirmPasswordReset,
    } = await import('../../src/services/authVerificationService');

    queryMock.mockResolvedValueOnce([[{ id: 1, name: 'Usuário', email_verified_at: null }]]);
    const sendResult = await sendEmailVerification({ email: 'user@test.com' });
    expect(sendResult.status).toBe('ok');
    expect(issueEmailCodeChallengeMock).toHaveBeenCalled();

    await expect(checkEmailVerification({ email: 'user@test.com' })).rejects.toBeInstanceOf(
      ConflictError,
    );

    const verifyEmailResult = await verifyEmailVerificationCode({
      email: 'user@test.com',
      code: '123456',
    });
    expect(verifyEmailResult.status).toBe('verified');

    queryMock.mockResolvedValueOnce([[]]);
    const resetResult = await requestPasswordReset({ email: 'missing@test.com' });
    expect(resetResult.message).toContain('Se o email informado existir');

    const verifyResetResult = await verifyPasswordResetCode({
      email: 'user@test.com',
      code: '123456',
    });
    expect(verifyResetResult.status).toBe('verified');

    const confirmResult = await confirmPasswordReset({
      email: 'user@test.com',
      reset_session_token: 'reset-session',
      new_password: 'Senha123',
    });
    expect(confirmResult.status).toBe('consumed');
    expect(hashMock).toHaveBeenCalledWith('Senha123', 8);
  });

  it('verifies phone profile lookup and CRECI lookup', async () => {
    const { verifyPhone, checkCreci, checkEmail } = await import('../../src/services/authVerificationService');

    queryMock.mockResolvedValueOnce([
      [
        {
          id: 9,
          name: 'Fulano',
          email: 'fulano@test.com',
          email_verified_at: null,
          phone: '62999998888',
          street: 'Rua A',
          number: '10',
          complement: null,
          bairro: 'Centro',
          city: 'Cidade',
          state: 'GO',
          cep: '75900000',
          broker_id: null,
          broker_status: null,
          creci: null,
        },
      ],
    ]);
    const phoneResult = await verifyPhone({ email: 'fulano@test.com' });
    expect(phoneResult.needsCompletion).toBe(false);

    queryMock.mockResolvedValueOnce([[]]);
    const emailResult = await checkEmail({ email: 'missing@test.com' });
    expect(emailResult.exists).toBe(false);

    queryMock.mockResolvedValueOnce([[]]);
    const creciResult = await checkCreci({ creci: '12345678-A' });
    expect(creciResult.exists).toBe(false);
  });
});
