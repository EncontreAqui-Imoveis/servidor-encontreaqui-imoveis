import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createTransportMock, sendMailMock, fetchMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: createTransportMock,
  },
}));

import {
  resetEmailServiceForTests,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
} from './emailService';

describe('emailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    resetEmailServiceForTests();

    delete process.env.EMAIL_PROVIDER;
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_API_BASE_URL;
    delete process.env.BREVO_FROM;
    delete process.env.BREVO_FROM_NAME;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_BASE_URL;
    delete process.env.RESEND_FROM;
    delete process.env.RESEND_FROM_NAME;
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_FROM_NAME;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_SERVICE;
    delete process.env.EMAIL_HTTP_TIMEOUT_MS;

    sendMailMock.mockResolvedValue(undefined);
    createTransportMock.mockReturnValue({
      sendMail: sendMailMock,
    });
  });

  it('sends verification email through Brevo HTTP API with idempotency key', async () => {
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.EMAIL_FROM = 'no-reply@encontreaquiimoveis.com';
    process.env.EMAIL_FROM_NAME = 'EncontreAqui Imoveis';

    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ messageId: 'brevo-123' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendEmailVerificationEmail({
      to: 'user@test.com',
      name: 'Usuario',
      actionUrl: 'https://site.exemplo.com/auth/verificar-email?oobCode=123',
      expiresAt: new Date('2026-03-06T15:00:00.000Z'),
      idempotencyKey: 'email-verification-42',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.method).toBe('POST');
    expect(options.headers['api-key']).toBe('brevo-key');

    const payload = JSON.parse(String(options.body));
    expect(payload.sender).toEqual({
      email: 'no-reply@encontreaquiimoveis.com',
      name: 'EncontreAqui Imoveis',
    });
    expect(payload.to).toEqual([{ email: 'user@test.com' }]);
    expect(payload.subject).toBe('Verifique seu email do app EncontreAqui Imoveis');
    expect(payload.headers).toEqual({
      idempotencyKey: 'email-verification-42',
    });
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('sends verification email through Resend HTTP API with idempotency key', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.EMAIL_FROM = 'no-reply@encontreaquiimoveis.com';

    fetchMock.mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({ id: 'email_123' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendEmailVerificationEmail({
      to: 'user@test.com',
      name: 'Usuario',
      actionUrl: 'https://site.exemplo.com/auth/verificar-email?oobCode=123',
      expiresAt: new Date('2026-03-06T15:00:00.000Z'),
      idempotencyKey: 'email-verification-42',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer resend-key');
    expect(options.headers['Idempotency-Key']).toBe('email-verification-42');

    const payload = JSON.parse(String(options.body));
    expect(payload.from).toBe('no-reply@encontreaquiimoveis.com');
    expect(payload.to).toEqual(['user@test.com']);
    expect(payload.subject).toBe('Verifique seu email do app EncontreAqui Imoveis');
    expect(payload.html).toContain('Clique aqui para confirmar seu e-mail');
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it('falls back to SMTP when Resend is not configured', async () => {
    process.env.SMTP_HOST = 'smtp.exemplo.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_SECURE = 'true';
    process.env.SMTP_FAMILY = '4';
    process.env.SMTP_TLS_SERVERNAME = 'smtp.exemplo.com';
    process.env.SMTP_USER = 'mailer@test.com';
    process.env.SMTP_PASS = 'smtp-pass';
    process.env.SMTP_FROM = 'mailer@test.com';

    await sendPasswordResetEmail({
      to: 'user@test.com',
      name: 'Usuario',
      code: '123456',
    });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(createTransportMock.mock.calls[0][0]).toMatchObject({
      host: 'smtp.exemplo.com',
      port: 465,
      secure: true,
      family: 4,
      tls: {
        servername: 'smtp.exemplo.com',
      },
    });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0]).toMatchObject({
      from: 'mailer@test.com',
      to: 'user@test.com',
      subject: 'Recuperacao de senha',
    });
  });

  it('surfaces brevo provider errors with status code context', async () => {
    process.env.EMAIL_PROVIDER = 'brevo';
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.EMAIL_FROM = 'no-reply@encontreaquiimoveis.com';

    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'invalid api key' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendEmailVerificationEmail({
        to: 'user@test.com',
        actionUrl: 'https://site.exemplo.com/auth/verificar-email?oobCode=123',
        expiresAt: new Date('2026-03-06T15:00:00.000Z'),
      }),
    ).rejects.toThrow('Brevo send failed (401): invalid api key');
  });

  it('surfaces resend provider errors with status code context', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.EMAIL_FROM = 'no-reply@encontreaquiimoveis.com';

    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue(JSON.stringify({ message: 'domain not verified' })),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      sendEmailVerificationEmail({
        to: 'user@test.com',
        actionUrl: 'https://site.exemplo.com/auth/verificar-email?oobCode=123',
        expiresAt: new Date('2026-03-06T15:00:00.000Z'),
      }),
    ).rejects.toThrow('Resend send failed (422): domain not verified');
  });
});
