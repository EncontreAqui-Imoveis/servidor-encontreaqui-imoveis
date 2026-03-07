import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import admin from '../config/firebaseAdmin';
import { authDb } from '../services/authPersistenceService';
import {
  confirmPasswordReset as confirmPasswordResetChallenge,
  deleteEmailCodeChallenge,
  getEmailVerificationStatus,
  issueEmailCodeChallenge,
  verifyEmailCode,
  verifyPasswordResetCode as verifyPasswordResetChallengeCode,
} from '../services/emailCodeChallengeService';
import {
  sendEmailCodeEmail,
} from '../services/emailService';
import {
  buildUserPayload,
  hasCompleteProfile,
  signUserToken,
  type ProfileType,
  withTimeout,
} from '../services/authSessionService';
import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import { phoneOtpService } from '../services/phoneOtpService';
import { sanitizeAddressInput } from '../utils/address';
import { hasValidCreci, normalizeCreci } from '../utils/creci';

class AuthController {
  private normalizePhoneOtpInput(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '');
  }

  private normalizeEmailCodeInput(value: unknown): string {
    return String(value ?? '').replace(/\D/g, '');
  }

  private isPasswordValid(password: string): boolean {
    return password.trim().length >= 6;
  }

  private buildOtpIssueResponse(issue: {
    sessionToken: string;
    expiresAt: Date;
    code: string;
  }) {
    const base = {
      sessionToken: issue.sessionToken,
      expiresAt: issue.expiresAt.toISOString(),
    };

    if (process.env.NODE_ENV === 'test') {
      return {
        ...base,
        otpCode: issue.code,
      };
    }

    return base;
  }

  private correlationId(req: Request): string | null {
    return getRequestId(req);
  }

  private errorWithCode(
    req: Request,
    res: Response,
    statusCode: number,
    code: string,
    error: string,
    retryable: boolean,
    extras?: Record<string, unknown>
  ) {
    return res.status(statusCode).json({
      status: 'error',
      code,
      error,
      retryable,
      correlation_id: this.correlationId(req),
      ...(extras ?? {}),
    });
  }

  async requestOtp(req: Request, res: Response) {
    const phone = this.normalizePhoneOtpInput(req.body?.phone);
    if (phone.length < 8) {
      return res.status(400).json({ error: 'Telefone invalido.' });
    }

    const issue = phoneOtpService.requestOtp(phone);
    return res.status(200).json(this.buildOtpIssueResponse(issue));
  }

  async resendOtp(req: Request, res: Response) {
    const sessionToken = String(req.body?.sessionToken ?? '').trim();
    if (!sessionToken) {
      return res.status(400).json({ error: 'sessionToken e obrigatorio.' });
    }

    const issue = phoneOtpService.resendOtp(sessionToken);
    if (!issue) {
      return res.status(404).json({ error: 'Sessao OTP nao encontrada.' });
    }

    return res.status(200).json(this.buildOtpIssueResponse(issue));
  }

  async verifyOtp(req: Request, res: Response) {
    const sessionToken = String(req.body?.sessionToken ?? '').trim();
    const code = String(req.body?.code ?? '').replace(/\D/g, '');

    if (!sessionToken || code.length !== 6) {
      return res.status(400).json({ error: 'sessionToken e codigo sao obrigatorios.' });
    }

    const result = phoneOtpService.verifyOtp(sessionToken, code);
    if (!result.ok) {
      return res.status(400).json({ error: 'Codigo invalido ou expirado.' });
    }

    return res.status(200).json({ ok: true });
  }

  async checkEmail(req: Request, res: Response) {
    const email = String(req.query.email ?? req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email e obrigatorio.' });
    }

    try {
      const [rows] = await authDb.query<RowDataPacket[]>(
        'SELECT id, firebase_uid, password_hash FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      const exists = rows.length > 0;
      const hasFirebaseUid = exists && rows[0].firebase_uid != null;
      const hasPassword = exists && !!rows[0].password_hash;
      return res.status(200).json({ exists, hasFirebaseUid, hasPassword });
    } catch (error) {
      console.error('Erro ao verificar email:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async requestPasswordReset(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const genericMessage =
      'Se o email informado existir, enviaremos um codigo para redefinir sua senha.';
    if (!email) {
      return res.status(400).json({ error: 'Email e obrigatorio.' });
    }

    try {
      const [rows] = await authDb.query<RowDataPacket[]>(
        'SELECT id, name, firebase_uid, password_hash FROM users WHERE email = ? LIMIT 1',
        [email],
      );

      if (rows.length === 0) {
        return res.status(200).json({ message: genericMessage });
      }

      const user = rows[0];
      const hasFirebaseUid = user.firebase_uid != null;
      const hasPassword = !!user.password_hash;
      if (hasFirebaseUid && !hasPassword) {
        return res.status(200).json({ message: genericMessage });
      }

      const issue = await issueEmailCodeChallenge({
        email,
        purpose: 'password_reset',
        userId: Number(user.id) || null,
      });
      if (!issue.allowed) {
        return res.status(200).json({
          message: genericMessage,
          status: 'ok',
          delivery: 'sent',
          resend_type: 'resend',
          expires_at: new Date(
            Date.now() + 15 * 60 * 1000
          ).toISOString(),
        });
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
        return this.errorWithCode(
          req,
          res,
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Servico temporariamente indisponivel. Tente novamente em instantes.',
          true
        );
      }

      return res.status(200).json({
        status: 'ok',
        delivery: 'sent',
        resend_type: issue.resendType,
        expires_at: issue.expiresAt.toISOString(),
        cooldown_sec: issue.cooldownSec,
        daily_remaining: issue.dailyRemaining,
        message: genericMessage,
        correlation_id: this.correlationId(req),
      });
    } catch (error) {
      console.error('Erro ao solicitar reset de senha:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async sendEmailVerification(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return this.errorWithCode(
        req,
        res,
        400,
        'EMAIL_REQUIRED',
        'Email e obrigatorio.',
        false
      );
    }
    try {
      const [userRows] = await authDb.query<RowDataPacket[]>(
        'SELECT id, name, email_verified_at FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      const userId =
        userRows.length > 0 ? Number(userRows[0].id) || null : null;
      const userName =
        userRows.length > 0 ? String(userRows[0].name ?? '').trim() || null : null;
      const emailVerifiedAt = userRows.length > 0
        ? userRows[0].email_verified_at ?? null
        : null;

      if (emailVerifiedAt != null) {
        return res.status(200).json({
          status: 'ok',
          delivery: 'already_verified',
          resend_type: 'initial',
          expires_at: null,
          cooldown_sec: 0,
          daily_remaining: 0,
          verified: true,
          verified_at: new Date(emailVerifiedAt).toISOString(),
          correlation_id: this.correlationId(req),
        });
      }

      const issue = await issueEmailCodeChallenge({
        email,
        purpose: 'verify_email',
        userId,
      });
      if (!issue.allowed) {
        return this.errorWithCode(
          req,
          res,
          429,
          issue.code,
          `Aguarde ${issue.retryAfterSeconds}s para reenviar.`,
          true,
          {
            retry_after_seconds: issue.retryAfterSeconds,
            daily_remaining: issue.dailyRemaining,
          }
        );
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
        return this.errorWithCode(
          req,
          res,
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Servico temporariamente indisponivel. Tente novamente em instantes.',
          true
        );
      }

      return res.status(200).json({
        status: 'ok',
        delivery: 'sent',
        resend_type: issue.resendType,
        expires_at: issue.expiresAt.toISOString(),
        cooldown_sec: issue.cooldownSec,
        daily_remaining: issue.dailyRemaining,
        correlation_id: this.correlationId(req),
      });
    } catch (error) {
      console.error('Erro ao enviar verificacao de email:', error);
      return this.errorWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Erro interno do servidor.',
        false
      );
    }
  }

  async checkEmailVerification(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email) {
      return this.errorWithCode(
        req,
        res,
        400,
        'EMAIL_REQUIRED',
        'Email e obrigatorio.',
        false
      );
    }

    try {
      const status = await getEmailVerificationStatus({ email });

      if (status.status === 'verified') {
        return res.status(200).json({
          status: 'ok',
          verified: true,
          verified_at: status.verifiedAt?.toISOString() ?? null,
          correlation_id: this.correlationId(req),
        });
      }

      if (status.status === 'expired') {
        return this.errorWithCode(
          req,
          res,
          410,
          'EMAIL_LINK_EXPIRED',
          'Esse link expirou. Solicite um novo.',
          true,
          {
            expires_at: status.expiresAt?.toISOString() ?? null,
          }
        );
      }

      return this.errorWithCode(
        req,
        res,
        409,
        'EMAIL_VERIFICATION_PENDING',
        'Ainda nao identificamos a verificacao. Tente novamente em instantes.',
        true,
        {
          expires_at: status.expiresAt?.toISOString() ?? null,
        }
      );
    } catch (error) {
      console.error('Erro ao validar status de verificacao de email:', error);
      return this.errorWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Erro interno do servidor.',
        false
        );
    }
  }

  async verifyEmailVerificationCode(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const code = this.normalizeEmailCodeInput(req.body?.code);

    if (!email || code.length !== 6) {
      return this.errorWithCode(
        req,
        res,
        400,
        'EMAIL_CODE_REQUIRED',
        'Email e codigo de 6 digitos sao obrigatorios.',
        false
      );
    }

    try {
      const result = await verifyEmailCode({ email, code });
      if (result.status === 'verified') {
        return res.status(200).json({
          status: 'ok',
          verified: true,
          verified_at: result.verifiedAt.toISOString(),
          correlation_id: this.correlationId(req),
        });
      }

      if (result.status === 'expired') {
        return this.errorWithCode(
          req,
          res,
          410,
          'EMAIL_CODE_EXPIRED',
          'Esse codigo expirou. Solicite um novo.',
          true,
          {
            expires_at: result.expiresAt?.toISOString() ?? null,
          }
        );
      }

      if (result.status === 'locked') {
        return this.errorWithCode(
          req,
          res,
          423,
          'EMAIL_CODE_LOCKED',
          'Voce atingiu o limite de tentativas. Solicite um novo codigo.',
          true
        );
      }

      return this.errorWithCode(
        req,
        res,
        400,
        'EMAIL_CODE_INVALID',
        'Codigo invalido.',
        false,
        result.status === 'invalid'
          ? { remaining_attempts: result.remainingAttempts }
          : undefined
      );
    } catch (error) {
      console.error('Erro ao validar codigo de verificacao de email:', error);
      return this.errorWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Erro interno do servidor.',
        false
      );
    }
  }

  async verifyPasswordResetCode(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const code = this.normalizeEmailCodeInput(req.body?.code);

    if (!email || code.length !== 6) {
      return this.errorWithCode(
        req,
        res,
        400,
        'PASSWORD_RESET_CODE_REQUIRED',
        'Email e codigo de 6 digitos sao obrigatorios.',
        false
      );
    }

    try {
      const result = await verifyPasswordResetChallengeCode({ email, code });
      if (result.status === 'verified') {
        return res.status(200).json({
          status: 'ok',
          reset_session_token: result.resetSessionToken,
          expires_at: result.expiresAt.toISOString(),
          correlation_id: this.correlationId(req),
        });
      }

      if (result.status === 'expired') {
        return this.errorWithCode(
          req,
          res,
          410,
          'PASSWORD_RESET_CODE_EXPIRED',
          'Esse codigo expirou. Solicite um novo.',
          true,
          {
            expires_at: result.expiresAt?.toISOString() ?? null,
          }
        );
      }

      if (result.status === 'locked') {
        return this.errorWithCode(
          req,
          res,
          423,
          'PASSWORD_RESET_CODE_LOCKED',
          'Voce atingiu o limite de tentativas. Solicite um novo codigo.',
          true
        );
      }

      return this.errorWithCode(
        req,
        res,
        400,
        'PASSWORD_RESET_CODE_INVALID',
        'Codigo invalido.',
        false,
        result.status === 'invalid'
          ? { remaining_attempts: result.remainingAttempts }
          : undefined
      );
    } catch (error) {
      console.error('Erro ao validar codigo de redefinicao de senha:', error);
      return this.errorWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Erro interno do servidor.',
        false
      );
    }
  }

  async confirmPasswordReset(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const resetSessionToken = String(req.body?.reset_session_token ?? '').trim();
    const newPassword = String(req.body?.new_password ?? '');

    if (!email || !resetSessionToken || !this.isPasswordValid(newPassword)) {
      return this.errorWithCode(
        req,
        res,
        400,
        'PASSWORD_RESET_CONFIRM_INVALID',
        'Email, sessao de redefinicao e nova senha valida sao obrigatorios.',
        false
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
        return res.status(200).json({
          status: 'ok',
          reset_at: result.consumedAt.toISOString(),
          correlation_id: this.correlationId(req),
        });
      }

      if (result.status === 'expired') {
        return this.errorWithCode(
          req,
          res,
          410,
          'PASSWORD_RESET_SESSION_EXPIRED',
          'Sua sessao de redefinicao expirou. Solicite um novo codigo.',
          true,
          {
            expires_at: result.expiresAt?.toISOString() ?? null,
          }
        );
      }

      return this.errorWithCode(
        req,
        res,
        400,
        'PASSWORD_RESET_SESSION_INVALID',
        'Sessao de redefinicao invalida.',
        false
      );
    } catch (error) {
      console.error('Erro ao confirmar redefinicao de senha:', error);
      return this.errorWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Erro interno do servidor.',
        false
      );
    }
  }

  // confirmPasswordReset deprecated/removed as Firebase handles the UI.

  async verifyPhone(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: 'Email e obrigatorio.' });
    }

    try {
      const [rows] = await authDb.query<RowDataPacket[]>(
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
        return res.status(404).json({ error: 'Usuario nao encontrado.' });
      }

      const row = rows[0];
      const brokerStatus = String(row.broker_status ?? '').trim();
      const profile: ProfileType =
        row.broker_id != null &&
        (brokerStatus === 'approved' || brokerStatus === 'pending_verification')
          ? 'broker'
          : 'client';

      const userPayload = buildUserPayload(row, profile);

      return res.status(200).json({
        user: userPayload,
        broker: userPayload.broker,
        needsCompletion: !hasCompleteProfile(row),
      });
    } catch (error) {
      console.error('Erro ao verificar telefone:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async register(req: Request, res: Response) {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const phone = typeof body.phone === 'string' ? body.phone : undefined;
    const street = body.street;
    const number = body.number;
    const complement = body.complement;
    const bairro = body.bairro;
    const city = body.city;
    const state = body.state;
    const cep = body.cep;
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

      const addressResult = sanitizeAddressInput({
        street,
        number,
        complement,
        bairro,
        city,
        state,
        cep,
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

      const [userResult] = await authDb.query<ResultSetHeader>(
        `
          INSERT INTO users (firebase_uid, name, email, email_verified_at, password_hash, phone, street, number, complement, bairro, city, state, cep)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          firebaseUid,
          name,
          email,
          isGoogleRegistration ? new Date() : null,
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
          email_verified_at: isGoogleRegistration ? new Date().toISOString() : null,
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
    const { email, password } = req.body as { email?: string; password?: string };

    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
      const [rows] = await authDb.query<RowDataPacket[]>(
        `
          SELECT u.id, u.name, u.email, u.email_verified_at, u.password_hash, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep,
                 u.token_version,
                 CASE
                   WHEN b.id IS NOT NULL AND b.status IN ('approved', 'pending_verification') THEN 'broker'
                   ELSE 'client'
                 END AS role,
                 b.id AS broker_id,
                 b.status AS broker_status,
                 b.creci AS creci,
                 bd.status AS broker_documents_status
          FROM users u
          LEFT JOIN brokers b ON u.id = b.id
          LEFT JOIN broker_documents bd ON b.id = bd.broker_id
          WHERE u.email = ?
        `,
        [email],
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const user = rows[0];
      const isPasswordCorrect = await bcrypt.compare(password, String(user.password_hash));

      if (!isPasswordCorrect) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const profile: ProfileType = user.role === 'broker' ? 'broker' : 'client';
      const brokerDocsStatus = String(user.broker_documents_status ?? '').trim().toLowerCase();
      const requiresDocuments =
        profile === 'broker' && (brokerDocsStatus.length === 0 || brokerDocsStatus == 'rejected');
      const token = signUserToken(user.id, profile, user.token_version);

      return res.json({
        user: buildUserPayload(user, profile),
        token,
        needsCompletion: !hasCompleteProfile(user),
        requiresDocuments,
      });
    } catch (error) {
      console.error('Erro no login:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async google(req: Request, res: Response) {
    const { idToken, profileType } = req.body as {
      idToken?: string;
      profileType?: string;
    };

    if (!idToken) {
      return res.status(400).json({ error: 'idToken do Google e obrigatorio.' });
    }

    const requestedProfile: ProfileType | 'auto' =
      profileType === 'broker' ? 'broker' : profileType === 'client' ? 'client' : 'auto';

    try {
      const decoded = await withTimeout(
        admin.auth().verifyIdToken(idToken),
        8000,
        'firebase token verification',
      );

      const uid = decoded.uid;
      const email = String(decoded.email ?? '').trim().toLowerCase();
      const displayName =
        String(decoded.name ?? '').trim() ||
        email.split('@')[0] ||
        `User-${uid}`;

      if (!email) {
        return res.status(400).json({
          error: 'Email nao disponivel no token do Google.',
        });
      }

      const [existingRows] = await authDb.query<RowDataPacket[]>(
        `SELECT u.id, u.name, u.email, u.email_verified_at, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep, u.firebase_uid, u.token_version,
                b.id AS broker_id, b.status AS broker_status, b.creci AS creci,
                bd.status AS broker_documents_status
           FROM users u
           LEFT JOIN brokers b ON u.id = b.id
           LEFT JOIN broker_documents bd ON u.id = bd.broker_id
          WHERE u.firebase_uid = ? OR u.email = ?
          LIMIT 1`,
        [uid, email],
      );

      if (existingRows.length === 0) {
        return res.status(200).json({
          isNewUser: true,
          requiresProfileChoice: true,
          pending: {
            email,
            name: displayName,
            googleUid: uid,
          },
          roleLocked: false,
          needsCompletion: true,
          requiresDocuments: false,
        });
      }

      const row = existingRows[0];
      if (!row.firebase_uid) {
        await authDb.query('UPDATE users SET firebase_uid = ? WHERE id = ?', [uid, row.id]);
      }
      if (decoded.email_verified === true && row.email_verified_at == null) {
        await authDb.query(
          'UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?',
          [new Date(), row.id],
        );
        row.email_verified_at = new Date().toISOString();
      }

      const brokerStatus = String(row.broker_status ?? '').trim();
      const brokerDocsStatus = String(row.broker_documents_status ?? '')
        .trim()
        .toLowerCase();
      const blockedBrokerRequest = brokerStatus === 'rejected';
      const isBroker =
        row.broker_id != null &&
        !blockedBrokerRequest &&
        (brokerStatus === 'approved' || brokerStatus === 'pending_verification');
      const effectiveProfile: ProfileType = isBroker ? 'broker' : 'client';
      const requiresDocuments =
        effectiveProfile === 'broker' &&
        (brokerDocsStatus.length === 0 || brokerDocsStatus === 'rejected');
      const token = signUserToken(row.id, effectiveProfile, row.token_version);

      return res.status(200).json({
        user: buildUserPayload(row, effectiveProfile),
        token,
        needsCompletion: !hasCompleteProfile(row),
        requiresDocuments,
        blockedBrokerRequest,
        roleLocked: blockedBrokerRequest || effectiveProfile === 'broker',
        isNewUser: false,
        requestedProfile,
      });
    } catch (error: any) {
      console.error('Google auth error:', error);
      const details = String(error?.sqlMessage || error?.message || '').toLowerCase();
      const status = details.includes('timeout') ? 504 : 500;
      return res.status(status).json({
        error: 'Erro ao autenticar com Google.',
      });
    }
  }

  async logout(req: AuthRequest, res: Response) {
    const userId = Number(req.userId);

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    try {
      const [result] = await authDb.query<ResultSetHeader>(
        'UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
        [userId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Usuario nao encontrado.' });
      }

      return res.status(200).json({ message: 'Logout realizado com sucesso.' });
    } catch (error: any) {
      if (error?.code === 'ER_BAD_FIELD_ERROR') {
        return res.status(200).json({ message: 'Logout realizado com sucesso.' });
      }

      console.error('Erro no logout:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }
}

export const authController = new AuthController();

