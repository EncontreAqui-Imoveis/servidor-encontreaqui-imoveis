import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import admin from '../config/firebaseAdmin';
import { authDb } from '../services/authPersistenceService';
import { getEmailVerificationStatus } from '../services/emailCodeChallengeService';
import {
  buildUserPayload,
  hasCompleteProfile,
  signUserToken,
  type ProfileType,
  withTimeout,
} from '../services/authSessionService';
import { google as googleSession, login as loginSession, logout as logoutSession } from '../services/authSessionOperationsService';
import {
  checkCreci as checkCreciService,
  checkEmail as checkEmailService,
  checkEmailVerification as checkEmailVerificationService,
  confirmPasswordReset as confirmPasswordResetService,
  requestOtp as requestOtpService,
  requestPasswordReset as requestPasswordResetService,
  resendOtp as resendOtpService,
  sendEmailVerification as sendEmailVerificationService,
  verifyEmailVerificationCode as verifyEmailVerificationCodeService,
  verifyOtp as verifyOtpService,
  verifyPasswordResetCode as verifyPasswordResetCodeService,
  verifyPhone as verifyPhoneService,
} from '../services/authVerificationService';
import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import { sanitizeAddressInput } from '../utils/address';
import { hasValidCreci, normalizeCreci } from '../utils/creci';
import {
  applicationErrorToHttpStatus,
  isApplicationError,
} from '../errors/ApplicationError';

function appErrorDetails(error: unknown): Record<string, unknown> {
  if (!isApplicationError(error)) {
    return {};
  }

  const details = { ...(error.details ?? {}) };
  delete (details as { code?: unknown }).code;
  delete (details as { retryable?: unknown }).retryable;
  return details;
}

function respondPlainError(res: Response, error: unknown): Response {
  if (isApplicationError(error)) {
    return res.status(applicationErrorToHttpStatus(error)).json({ error: error.message });
  }

  const message = error instanceof Error ? error.message : 'Erro interno do servidor.';
  return res.status(500).json({ error: message });
}

function respondStructuredError(req: Request, res: Response, error: unknown): Response {
  if (isApplicationError(error)) {
    const details = error.details ?? {};
    const code = String(details.code ?? error.name ?? 'INTERNAL_SERVER_ERROR');
    const retryable = Boolean(details.retryable ?? applicationErrorToHttpStatus(error) >= 500);
    return res.status(applicationErrorToHttpStatus(error)).json({
      status: 'error',
      code,
      error: error.message,
      retryable,
      correlation_id: getRequestId(req),
      ...appErrorDetails(error),
    });
  }

  const message = error instanceof Error ? error.message : 'Erro interno do servidor.';
  return res.status(500).json({
    status: 'error',
    code: 'INTERNAL_SERVER_ERROR',
    error: message,
    retryable: false,
    correlation_id: getRequestId(req),
  });
}

class AuthController {
  async requestOtp(req: Request, res: Response) {
    try {
      const result = requestOtpService({ phone: req.body?.phone });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async resendOtp(req: Request, res: Response) {
    try {
      const result = resendOtpService({ sessionToken: req.body?.sessionToken });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async verifyOtp(req: Request, res: Response) {
    try {
      const result = verifyOtpService({
        sessionToken: req.body?.sessionToken,
        code: req.body?.code,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async checkEmail(req: Request, res: Response) {
    try {
      const result = await checkEmailService({
        email: req.query.email ?? req.body?.email,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async requestPasswordReset(req: Request, res: Response) {
    try {
      const result = await requestPasswordResetService({ email: req.body?.email });
      return res.status(200).json(result);
    } catch (error) {
      if (isApplicationError(error) && error.code === 'INVALID_INPUT') {
        return respondPlainError(res, error);
      }
      return respondStructuredError(req, res, error);
    }
  }

  async checkCreci(req: Request, res: Response) {
    try {
      const result = await checkCreciService({ creci: req.query.creci ?? req.body?.creci });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async sendEmailVerification(req: Request, res: Response) {
    try {
      const result = await sendEmailVerificationService({ email: req.body?.email });
      return res.status(200).json({
        ...result,
        correlation_id: getRequestId(req),
      });
    } catch (error) {
      return respondStructuredError(req, res, error);
    }
  }

  async checkEmailVerification(req: Request, res: Response) {
    try {
      const result = await checkEmailVerificationService({ email: req.body?.email });
      return res.status(200).json({
        status: 'ok',
        verified: result.status === 'verified',
        verified_at: result.verified_at ?? null,
        expires_at: result.expires_at ?? null,
        correlation_id: getRequestId(req),
      });
    } catch (error) {
      return respondStructuredError(req, res, error);
    }
  }

  async verifyEmailVerificationCode(req: Request, res: Response) {
    try {
      const result = await verifyEmailVerificationCodeService({
        email: req.body?.email,
        code: req.body?.code,
      });
      return res.status(200).json({
        status: 'ok',
        verified: result.status === 'verified',
        verified_at: result.verified_at ?? null,
        expires_at: result.expires_at ?? null,
        remaining_attempts: result.remaining_attempts,
        correlation_id: getRequestId(req),
      });
    } catch (error) {
      return respondStructuredError(req, res, error);
    }
  }

  async verifyPasswordResetCode(req: Request, res: Response) {
    try {
      const result = await verifyPasswordResetCodeService({
        email: req.body?.email,
        code: req.body?.code,
      });
      return res.status(200).json({
        status: 'ok',
        reset_session_token: result.reset_session_token,
        expires_at: result.expires_at,
        correlation_id: getRequestId(req),
      });
    } catch (error) {
      return respondStructuredError(req, res, error);
    }
  }

  async confirmPasswordReset(req: Request, res: Response) {
    try {
      const result = await confirmPasswordResetService({
        email: req.body?.email,
        reset_session_token: req.body?.reset_session_token,
        new_password: req.body?.new_password,
      });
      return res.status(200).json({
        status: 'ok',
        reset_at: result.reset_at,
        correlation_id: getRequestId(req),
      });
    } catch (error) {
      return respondStructuredError(req, res, error);
    }
  }

  async verifyPhone(req: Request, res: Response) {
    try {
      const result = await verifyPhoneService({ email: req.body?.email });
      return res.status(200).json({
        user: result.user,
        broker: result.broker,
        needsCompletion: result.needsCompletion,
      });
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async register(req: Request, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const phone = typeof body.phone === 'string' ? body.phone : undefined;
    const cpf = typeof body.cpf === 'string' ? body.cpf.trim() : '';
    const street = body.street;
    const number = body.number;
    const complement = body.complement;
    const bairro = body.bairro;
    const city = body.city;
    const state = body.state;
    const cep = body.cep;
    const withoutNumberRaw = body.without_number ?? body.withoutNumber;
    const profileType = String(body.profileType ?? '');
    const creci = body.creci;
    const googleIdToken =
      typeof body.googleIdToken === 'string' ? body.googleIdToken.trim() : '';

    if (!name || !email) {
      return res.status(400).json({
        error: 'Nome e email sao obrigatorios.',
      });
    }

    const normalizedProfile: ProfileType =
      profileType === 'broker' ? 'broker' : 'client';
    const brokerCreci = normalizeCreci(creci);
    if (normalizedProfile === 'broker' && !hasValidCreci(brokerCreci)) {
      return res.status(400).json({
        error: 'CRECI invalido. Use 4 a 8 numeros com sufixo opcional (ex: 12345678-A).',
      });
    }

    const isGoogleRegistration = googleIdToken.length > 0;
    if (!isGoogleRegistration && !password) {
      return res.status(400).json({
        error: 'Senha obrigatoria para cadastro por email.',
      });
    }

    let firebaseUid: string | null = null;

    try {
      if (isGoogleRegistration) {
        const decoded = await withTimeout(
          admin.auth().verifyIdToken(googleIdToken),
          8000,
          'firebase token verification',
        );

        const tokenEmail = String(decoded.email ?? '')
          .trim()
          .toLowerCase();

        if (!tokenEmail) {
          return res.status(400).json({
            error: 'Email nao encontrado no token do Google.',
          });
        }

        if (tokenEmail !== email) {
          return res.status(400).json({
            error: 'Email informado nao corresponde ao token do Google.',
          });
        }

        firebaseUid = decoded.uid;
      }

      let existingUserRows: RowDataPacket[];
      if (firebaseUid) {
        [existingUserRows] = await authDb.query<RowDataPacket[]>(
          'SELECT id FROM users WHERE email = ? OR firebase_uid = ? LIMIT 1',
          [email, firebaseUid],
        );
      } else {
        [existingUserRows] = await authDb.query<RowDataPacket[]>(
          'SELECT id FROM users WHERE email = ? LIMIT 1',
          [email],
        );
      }

      if (existingUserRows.length > 0) {
        return res.status(409).json({ error: 'Este email ja esta em uso.' });
      }

      if (normalizedProfile === 'broker') {
        const [existingCreciRows] = await authDb.query<RowDataPacket[]>(
          'SELECT id FROM brokers WHERE creci = ? LIMIT 1',
          [brokerCreci],
        );
        if (existingCreciRows.length > 0) {
          return res.status(409).json({ error: 'Este CRECI ja esta em uso.' });
        }
      }

      const addressResult = sanitizeAddressInput({
        street,
        number,
        complement,
        bairro,
        city,
        state,
        cep,
        without_number: withoutNumberRaw,
      });
      if (!addressResult.ok) {
        return res.status(400).json({
          error: 'Endereco incompleto ou invalido.',
          fields: addressResult.errors,
        });
      }

      const passwordHash = isGoogleRegistration
        ? null
        : await bcrypt.hash(password, 8);
      let emailVerifiedAt: Date | null = isGoogleRegistration ? new Date() : null;
      if (!isGoogleRegistration) {
        const verificationStatus = await getEmailVerificationStatus({ email });
        if (verificationStatus.status === 'verified') {
          emailVerifiedAt = verificationStatus.verifiedAt ?? new Date();
        }
      }

      const [userResult] = await authDb.query<ResultSetHeader>(
        `
          INSERT INTO users (firebase_uid, name, email, cpf, email_verified_at, password_hash, phone, street, number, complement, bairro, city, state, cep)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          firebaseUid,
          name,
          email,
          cpf || null,
          emailVerifiedAt,
          passwordHash,
          phone ?? null,
          addressResult.value.street,
          addressResult.value.number,
          addressResult.value.complement,
          addressResult.value.bairro,
          addressResult.value.city,
          addressResult.value.state,
          addressResult.value.cep,
        ],
      );

      const userId = userResult.insertId;

      if (normalizedProfile === 'broker') {
        await authDb.query(
          'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
          [userId, brokerCreci, 'pending_verification'],
        );
      }

      const token = signUserToken(userId, normalizedProfile, 1);
      const userPayload = buildUserPayload(
        {
          id: userId,
          name,
          email,
          cpf: cpf || null,
          email_verified_at: emailVerifiedAt?.toISOString() ?? null,
          phone,
          street: addressResult.value.street,
          number: addressResult.value.number,
          complement: addressResult.value.complement,
          bairro: addressResult.value.bairro,
          city: addressResult.value.city,
          state: addressResult.value.state,
          cep: addressResult.value.cep,
          broker_id: normalizedProfile === 'broker' ? userId : null,
          broker_status:
            normalizedProfile === 'broker' ? 'pending_verification' : null,
          creci: normalizedProfile === 'broker' ? brokerCreci : null,
        },
        normalizedProfile,
      );

      return res.status(201).json({
        user: userPayload,
        broker: userPayload.broker,
        token,
        needsCompletion: !hasCompleteProfile({
          phone,
          street: addressResult.value.street,
          number: addressResult.value.number,
          bairro: addressResult.value.bairro,
          city: addressResult.value.city,
          state: addressResult.value.state,
          cep: addressResult.value.cep,
        }),
        requiresDocuments: normalizedProfile === 'broker',
      });
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Este email ja esta em uso.' });
      }
      console.error('Erro no registro:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const result = await loginSession({
        email: req.body?.email,
        password: req.body?.password,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async google(req: Request, res: Response) {
    try {
      const result = await googleSession({
        idToken: req.body?.idToken,
        profileType: req.body?.profileType,
      });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }

  async logout(req: AuthRequest, res: Response) {
    try {
      const result = await logoutSession({ userId: Number(req.userId) });
      return res.status(200).json(result);
    } catch (error) {
      return respondPlainError(res, error);
    }
  }
}

export const authController = new AuthController();
