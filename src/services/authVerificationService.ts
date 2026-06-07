import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2';
import {
  ConflictError,
  InternalError,
  InvalidInputError,
  LockedError,
  NotFoundError,
  TooManyRequestsError,
  UnavailableError,
  GoneError,
} from '../errors/ApplicationError';
import {
  confirmPasswordReset as confirmPasswordResetChallenge,
  deleteEmailCodeChallenge,
  getEmailVerificationStatus,
  issueEmailCodeChallenge,
  verifyEmailCode,
  verifyPasswordResetCode as verifyPasswordResetChallengeCode,
} from './emailCodeChallengeService';
import { sendEmailCodeEmail } from './emailService';
import { authDb } from './authPersistenceService';
import { buildUserPayload, hasCompleteProfile, type ProfileType } from './authSessionService';
import { phoneOtpService } from './phoneOtpService';
import { hasValidCreci, normalizeCreci } from '../utils/creci';

type AuthVerificationRow = RowDataPacket & {
  id: number;
  name?: string | null;
  email?: string | null;
  email_verified_at?: string | null;
  firebase_uid?: string | null;
  password_hash?: string | null;
  phone?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  bairro?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
  broker_id?: number | null;
  broker_status?: string | null;
  creci?: string | null;
};

export interface RequestOtpInput {
  phone?: string;
}

export interface OtpIssueResult {
  sessionToken: string;
  expiresAt: Date;
  otpCode?: string;
}

export interface ResendOtpInput {
  sessionToken?: string;
}

export interface VerifyOtpInput {
  sessionToken?: string;
  code?: string;
}

export interface CheckEmailInput {
  email?: string;
}

export interface CheckEmailResult {
  exists: boolean;
  hasFirebaseUid: boolean;
  hasPassword: boolean;
}

export interface RequestPasswordResetInput {
  email?: string;
}

export interface RequestPasswordResetResult {
  message: string;
  status?: 'ok';
  delivery?: 'sent';
  resend_type?: 'initial' | 'resend';
  expires_at?: string | null;
  cooldown_sec?: number;
  daily_remaining?: number;
}

export interface CheckCreciInput {
  creci?: string;
}

export interface CheckCreciResult {
  exists: boolean;
}

export interface SendEmailVerificationInput {
  email?: string;
}

export interface SendEmailVerificationResult {
  status?: 'ok';
  delivery?: 'already_verified' | 'sent';
  resend_type?: 'initial' | 'resend';
  expires_at?: string | null;
  cooldown_sec?: number;
  daily_remaining?: number;
  verified?: boolean;
  verified_at?: string | null;
}

export interface CheckEmailVerificationInput {
  email?: string;
}

export interface CheckEmailVerificationResult {
  status: 'ok' | 'pending' | 'expired' | 'verified';
  verified?: boolean;
  verified_at?: string | null;
  expires_at?: string | null;
}

export interface VerifyEmailVerificationCodeInput {
  email?: string;
  code?: string;
}

export interface VerifyEmailVerificationCodeResult {
  status: 'ok' | 'verified' | 'invalid' | 'expired' | 'locked';
  verified?: boolean;
  verified_at?: string | null;
  expires_at?: string | null;
  remaining_attempts?: number;
}

export interface VerifyPasswordResetCodeInput {
  email?: string;
  code?: string;
}

export interface VerifyPasswordResetCodeResult {
  status: 'ok' | 'verified' | 'invalid' | 'expired' | 'locked';
  reset_session_token?: string;
  expires_at?: string;
  remaining_attempts?: number;
}

export interface ConfirmPasswordResetInput {
  email?: string;
  reset_session_token?: string;
  new_password?: string;
}

export interface ConfirmPasswordResetResult {
  status: 'ok' | 'consumed' | 'invalid' | 'expired';
  reset_at?: string;
  expires_at?: string | null;
}

export interface VerifyPhoneInput {
  email?: string;
}

export interface VerifyPhoneResult {
  user: ReturnType<typeof buildUserPayload>;
  broker: ReturnType<typeof buildUserPayload>['broker'];
  needsCompletion: boolean;
}

function normalizePhoneOtpInput(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeEmailCodeInput(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function isPasswordValid(password: string): boolean {
  return password.trim().length >= 6;
}

function toInvalidInput(message: string): never {
  throw new InvalidInputError(message);
}

export function requestOtp(input: RequestOtpInput): OtpIssueResult {
  const phone = normalizePhoneOtpInput(input.phone);
  if (phone.length < 8) {
    toInvalidInput('Telefone invalido.');
  }

  const issue = phoneOtpService.requestOtp(phone);
  return {
    sessionToken: issue.sessionToken,
    expiresAt: issue.expiresAt,
    otpCode: process.env.NODE_ENV === 'test' ? issue.code : undefined,
  };
}

export function resendOtp(input: ResendOtpInput): OtpIssueResult {
  const sessionToken = String(input.sessionToken ?? '').trim();
  if (!sessionToken) {
    throw new InvalidInputError('sessionToken e obrigatorio.', { code: 'SESSION_TOKEN_REQUIRED' });
  }

  const issue = phoneOtpService.resendOtp(sessionToken);
  if (!issue) {
    throw new NotFoundError('Sessao OTP nao encontrada.', { code: 'OTP_SESSION_NOT_FOUND' });
  }

  return {
    sessionToken: issue.sessionToken,
    expiresAt: issue.expiresAt,
    otpCode: process.env.NODE_ENV === 'test' ? issue.code : undefined,
  };
}

export function verifyOtp(input: VerifyOtpInput): { ok: true } {
  const sessionToken = String(input.sessionToken ?? '').trim();
  const code = String(input.code ?? '').replace(/\D/g, '');

  if (!sessionToken || code.length !== 6) {
    throw new InvalidInputError('sessionToken e codigo sao obrigatorios.', {
      code: 'OTP_CODE_REQUIRED',
    });
  }

  const result = phoneOtpService.verifyOtp(sessionToken, code);
  if (!result.ok) {
    throw new InvalidInputError('Codigo invalido ou expirado.', {
      code: 'OTP_CODE_INVALID',
    });
  }

  return { ok: true };
}

export async function checkEmail(input: CheckEmailInput): Promise<CheckEmailResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new InvalidInputError('Email e obrigatorio.', { code: 'EMAIL_REQUIRED' });
  }

  try {
    const [rows] = await authDb.query<RowDataPacket[]>(
      'SELECT id, firebase_uid, password_hash FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    const exists = rows.length > 0;
    const hasFirebaseUid = exists && rows[0].firebase_uid != null;
    const hasPassword = exists && !!rows[0].password_hash;
    return { exists, hasFirebaseUid, hasPassword };
  } catch (error) {
    console.error('Erro ao verificar email:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<RequestPasswordResetResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  const genericMessage =
    'Se o email informado existir, enviaremos um codigo para redefinir sua senha.';
  if (!email) {
    throw new InvalidInputError('Email e obrigatorio.', { code: 'EMAIL_REQUIRED' });
  }

  try {
    const [rows] = await authDb.query<RowDataPacket[]>(
      'SELECT id, name, firebase_uid, password_hash FROM users WHERE email = ? LIMIT 1',
      [email],
    );

    if (rows.length === 0) {
      return { message: genericMessage };
    }

    const user = rows[0];
    const hasFirebaseUid = user.firebase_uid != null;
    const hasPassword = !!user.password_hash;
    if (hasFirebaseUid && !hasPassword) {
      return { message: genericMessage };
    }

    const issue = await issueEmailCodeChallenge({
      email,
      purpose: 'password_reset',
      userId: Number(user.id) || null,
    });
    if (!issue.allowed) {
      return {
        message: genericMessage,
        status: 'ok',
        delivery: 'sent',
        resend_type: 'resend',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      };
    }

    try {
      await sendEmailCodeEmail({
        to: email,
        name: String(user.name ?? '').trim() || null,
        code: issue.code,
        purpose: 'password_reset',
        expiresAt: issue.expiresAt,
        idempotencyKey: `password-reset-${issue.requestId}`,
      });
    } catch (deliveryError) {
      await deleteEmailCodeChallenge(issue.requestId);
      console.error('Falha ao enviar codigo de redefinicao de senha:', deliveryError);
      throw new UnavailableError('Servico temporariamente indisponivel. Tente novamente em instantes.', {
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      });
    }

    return {
      status: 'ok',
      delivery: 'sent',
      resend_type: issue.resendType,
      expires_at: issue.expiresAt.toISOString(),
      cooldown_sec: issue.cooldownSec,
      daily_remaining: issue.dailyRemaining,
      message: genericMessage,
    };
  } catch (error) {
    if (error instanceof InvalidInputError || error instanceof UnavailableError) {
      throw error;
    }
    console.error('Erro ao solicitar reset de senha:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function checkCreci(input: CheckCreciInput): Promise<CheckCreciResult> {
  const creci = normalizeCreci(String(input.creci ?? ''));
  if (!creci) {
    throw new InvalidInputError('CRECI e obrigatorio.', { code: 'CRECI_REQUIRED' });
  }
  if (!hasValidCreci(creci)) {
    throw new InvalidInputError('CRECI invalido. Use 4 a 8 numeros com sufixo opcional (ex: 12345678-A).', {
      code: 'CRECI_INVALID',
    });
  }

  try {
    const [rows] = await authDb.query<RowDataPacket[]>(
      'SELECT id FROM brokers WHERE creci = ? LIMIT 1',
      [creci],
    );
    return { exists: rows.length > 0 };
  } catch (error) {
    console.error('Erro ao verificar CRECI:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function sendEmailVerification(
  input: SendEmailVerificationInput,
): Promise<SendEmailVerificationResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new InvalidInputError('Email e obrigatorio.', { code: 'EMAIL_REQUIRED' });
  }
  try {
    const [userRows] = await authDb.query<RowDataPacket[]>(
      'SELECT id, name, email_verified_at FROM users WHERE email = ? LIMIT 1',
      [email],
    );
    const userId = userRows.length > 0 ? Number(userRows[0].id) || null : null;
    const userName = userRows.length > 0 ? String(userRows[0].name ?? '').trim() || null : null;
    const emailVerifiedAt =
      userRows.length > 0 ? userRows[0].email_verified_at ?? null : null;

    if (emailVerifiedAt != null) {
      return {
        status: 'ok',
        delivery: 'already_verified',
        resend_type: 'initial',
        expires_at: null,
        cooldown_sec: 0,
        daily_remaining: 0,
        verified: true,
        verified_at: new Date(emailVerifiedAt).toISOString(),
      };
    }

    const issue = await issueEmailCodeChallenge({
      email,
      purpose: 'verify_email',
      userId,
    });
    if (!issue.allowed) {
      throw new TooManyRequestsError(`Aguarde ${issue.retryAfterSeconds}s para reenviar.`, {
        code: issue.code,
        retry_after_seconds: issue.retryAfterSeconds,
        daily_remaining: issue.dailyRemaining,
      });
    }

    try {
      await sendEmailCodeEmail({
        to: email,
        name: userName,
        code: issue.code,
        purpose: 'verify_email',
        expiresAt: issue.expiresAt,
        idempotencyKey: `email-verification-${issue.requestId}`,
      });
    } catch (deliveryError) {
      await deleteEmailCodeChallenge(issue.requestId);
      console.error('Falha ao montar ou enviar email de verificacao:', deliveryError);
      throw new UnavailableError('Servico temporariamente indisponivel. Tente novamente em instantes.', {
        code: 'DEPENDENCY_UNAVAILABLE',
        retryable: true,
      });
    }

    return {
      status: 'ok',
      delivery: 'sent',
      resend_type: issue.resendType,
      expires_at: issue.expiresAt.toISOString(),
      cooldown_sec: issue.cooldownSec,
      daily_remaining: issue.dailyRemaining,
    };
  } catch (error) {
    if (
      error instanceof InvalidInputError ||
      error instanceof TooManyRequestsError ||
      error instanceof UnavailableError
    ) {
      throw error;
    }
    console.error('Erro ao enviar verificacao de email:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function checkEmailVerification(
  input: CheckEmailVerificationInput,
): Promise<CheckEmailVerificationResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  if (!email) {
    throw new InvalidInputError('Email e obrigatorio.', { code: 'EMAIL_REQUIRED' });
  }

  try {
    const status = await getEmailVerificationStatus({ email });

    if (status.status === 'verified') {
      return {
        status: 'verified',
        verified: true,
        verified_at: status.verifiedAt?.toISOString() ?? null,
      };
    }

    if (status.status === 'expired') {
      throw new GoneError('Esse codigo expirou. Solicite um novo.', {
        code: 'EMAIL_CODE_EXPIRED',
        expires_at: status.expiresAt?.toISOString() ?? null,
      });
    }

    throw new ConflictError('Ainda nao identificamos a verificacao. Tente novamente em instantes.', {
      code: 'EMAIL_VERIFICATION_PENDING',
      expires_at: status.expiresAt?.toISOString() ?? null,
    });
  } catch (error) {
    if (error instanceof InvalidInputError || error instanceof GoneError || error instanceof ConflictError) {
      throw error;
    }
    console.error('Erro ao validar status de verificacao de email:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function verifyEmailVerificationCode(
  input: VerifyEmailVerificationCodeInput,
): Promise<VerifyEmailVerificationCodeResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  const code = normalizeEmailCodeInput(input.code);

  if (!email || code.length !== 6) {
    throw new InvalidInputError('Email e codigo de 6 digitos sao obrigatorios.', {
      code: 'EMAIL_CODE_REQUIRED',
    });
  }

  try {
    const result = await verifyEmailCode({ email, code });
    if (result.status === 'verified') {
      return {
        status: 'verified',
        verified: true,
        verified_at: result.verifiedAt.toISOString(),
      };
    }

    if (result.status === 'expired') {
      throw new GoneError('Esse codigo expirou. Solicite um novo.', {
        code: 'EMAIL_CODE_EXPIRED',
        expires_at: result.expiresAt?.toISOString() ?? null,
      });
    }

    if (result.status === 'locked') {
      throw new LockedError('Voce atingiu o limite de tentativas. Solicite um novo codigo.', {
        code: 'EMAIL_CODE_LOCKED',
      });
    }

    throw new InvalidInputError('Codigo invalido.', {
      code: 'EMAIL_CODE_INVALID',
      remaining_attempts: result.status === 'invalid' ? result.remainingAttempts : undefined,
    });
  } catch (error) {
    if (
      error instanceof InvalidInputError ||
      error instanceof GoneError ||
      error instanceof LockedError
    ) {
      throw error;
    }
    console.error('Erro ao validar codigo de verificacao de email:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function verifyPasswordResetCode(
  input: VerifyPasswordResetCodeInput,
): Promise<VerifyPasswordResetCodeResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  const code = normalizeEmailCodeInput(input.code);

  if (!email || code.length !== 6) {
    throw new InvalidInputError('Email e codigo de 6 digitos sao obrigatorios.', {
      code: 'PASSWORD_RESET_CODE_REQUIRED',
    });
  }

  try {
    const result = await verifyPasswordResetChallengeCode({ email, code });
    if (result.status === 'verified') {
      return {
        status: 'verified',
        reset_session_token: result.resetSessionToken,
        expires_at: result.expiresAt.toISOString(),
      };
    }

    if (result.status === 'expired') {
      throw new GoneError('Esse codigo expirou. Solicite um novo.', {
        code: 'PASSWORD_RESET_CODE_EXPIRED',
        expires_at: result.expiresAt?.toISOString() ?? null,
      });
    }

    if (result.status === 'locked') {
      throw new LockedError('Voce atingiu o limite de tentativas. Solicite um novo codigo.', {
        code: 'PASSWORD_RESET_CODE_LOCKED',
      });
    }

    throw new InvalidInputError('Codigo invalido.', {
      code: 'PASSWORD_RESET_CODE_INVALID',
      remaining_attempts: result.status === 'invalid' ? result.remainingAttempts : undefined,
    });
  } catch (error) {
    if (
      error instanceof InvalidInputError ||
      error instanceof GoneError ||
      error instanceof LockedError
    ) {
      throw error;
    }
    console.error('Erro ao validar codigo de redefinicao de senha:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function confirmPasswordReset(
  input: ConfirmPasswordResetInput,
): Promise<ConfirmPasswordResetResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  const resetSessionToken = String(input.reset_session_token ?? '').trim();
  const newPassword = String(input.new_password ?? '');

  if (!email || !resetSessionToken || !isPasswordValid(newPassword)) {
    throw new InvalidInputError(
      'Email, sessao de redefinicao e nova senha valida sao obrigatorios.',
      { code: 'PASSWORD_RESET_CONFIRM_INVALID' },
    );
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 8);
    const result = await confirmPasswordResetChallenge({
      email,
      resetSessionToken,
      passwordHash,
    });

    if (result.status === 'consumed') {
      return {
        status: 'consumed',
        reset_at: result.consumedAt.toISOString(),
      };
    }

    if (result.status === 'expired') {
      throw new GoneError('Sua sessao de redefinicao expirou. Solicite um novo codigo.', {
        code: 'PASSWORD_RESET_SESSION_EXPIRED',
        expires_at: result.expiresAt?.toISOString() ?? null,
      });
    }

    throw new InvalidInputError('Sessao de redefinicao invalida.', {
      code: 'PASSWORD_RESET_SESSION_INVALID',
    });
  } catch (error) {
    if (error instanceof InvalidInputError || error instanceof GoneError) {
      throw error;
    }
    console.error('Erro ao confirmar redefinicao de senha:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function verifyPhone(input: VerifyPhoneInput): Promise<VerifyPhoneResult> {
  const email = String(input.email ?? '').trim().toLowerCase();

  if (!email) {
    throw new InvalidInputError('Email e obrigatorio.', { code: 'EMAIL_REQUIRED' });
  }

  try {
    const [rows] = await authDb.query<AuthVerificationRow[]>(
      `
        SELECT
          u.id,
          u.name,
          u.email,
          u.email_verified_at,
          u.phone,
          u.street,
          u.number,
          u.complement,
          u.bairro,
          u.city,
          u.state,
          u.cep,
          b.id AS broker_id,
          b.status AS broker_status,
          b.creci AS creci
        FROM users u
        LEFT JOIN brokers b ON u.id = b.id
        WHERE u.email = ?
        LIMIT 1
      `,
      [email],
    );

    if (rows.length === 0) {
      throw new NotFoundError('Usuario nao encontrado.', { code: 'USER_NOT_FOUND' });
    }

    const row = rows[0];
    const brokerStatus = String(row.broker_status ?? '').trim();
    const profile: ProfileType =
      row.broker_id != null &&
      (brokerStatus === 'approved' || brokerStatus === 'pending_verification')
        ? 'broker'
        : 'client';

    const userPayload = buildUserPayload(row, profile);

    return {
      user: userPayload,
      broker: userPayload.broker,
      needsCompletion: !hasCompleteProfile(row),
    };
  } catch (error) {
    if (error instanceof InvalidInputError || error instanceof NotFoundError) {
      throw error;
    }
    console.error('Erro ao verificar telefone:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}
