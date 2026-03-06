import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import admin from '../config/firebaseAdmin';
import { authDb } from '../services/authPersistenceService';
import {
  checkEmailVerificationStatus,
  deleteEmailVerificationRequest,
  issueEmailVerificationRequest,
} from '../services/emailVerificationService';
import {
  buildEmailVerificationHandlerUrl,
  sendEmailVerificationEmail,
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
      'Se o email informado existir, as instrucoes de recuperacao serao enviadas.';
    if (!email) {
      return res.status(400).json({ error: 'Email e obrigatorio.' });
    }

    try {
      // 1. Check if user exists in SQL
      const [rows] = await authDb.query<RowDataPacket[]>(
        'SELECT id, name, firebase_uid FROM users WHERE email = ? LIMIT 1',
        [email],
      );

      if (rows.length === 0) {
        return res.status(200).json({ message: genericMessage });
      }

      const user = rows[0];

      // 2. If user is Legacy (no firebase_uid), migrate them NOW.
      if (!user.firebase_uid) {
        try {
          // Check if user already exists in Firebase (edge case: registered in Firebase but not linked in SQL)
          let firebaseUser;
          try {
            firebaseUser = await admin.auth().getUserByEmail(email);
          } catch (e: any) {
            if (e.code === 'auth/user-not-found') {
              // Create user in Firebase
              firebaseUser = await admin.auth().createUser({
                email: email,
                emailVerified: true, // We trust our SQL verification or just assume true for legacy
                displayName: user.name,
              });
            } else {
              throw e;
            }
          }

          // Update SQL with new UID
          await authDb.query(
            'UPDATE users SET firebase_uid = ? WHERE id = ?',
            [firebaseUser.uid, user.id],
          );
          console.log(`[Migration] User ${user.id} migrated to Firebase UID ${firebaseUser.uid}`);
        } catch (migrationError) {
          console.error('Erro na migracao para Firebase:', migrationError);
          return res.status(500).json({ error: 'Erro ao preparar conta para recuperacao.' });
        }
      }

      // 3. Respond OK so Frontend can trigger the Firebase SDK email
      return res.status(200).json({ message: genericMessage });
    } catch (error) {
      console.error('Erro ao solicitar reset de senha:', error);
      return res.status(500).json({ error: 'Erro interno do servidor.' });
    }
  }

  async sendEmailVerification(req: Request, res: Response) {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const handlerUrl = String(
      process.env.EMAIL_VERIFICATION_HANDLER_URL ?? ''
    ).trim();
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
    if (!handlerUrl) {
      return this.errorWithCode(
        req,
        res,
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Servico temporariamente indisponivel. Tente novamente em instantes.',
        true
      );
    }

    try {
      const [userRows] = await authDb.query<RowDataPacket[]>(
        'SELECT id, name FROM users WHERE email = ? LIMIT 1',
        [email]
      );
      const userId =
        userRows.length > 0 ? Number(userRows[0].id) || null : null;
      const userName =
        userRows.length > 0 ? String(userRows[0].name ?? '').trim() || null : null;

      const issue = await issueEmailVerificationRequest({ email, userId });
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
        const firebaseLink = await withTimeout(
          admin.auth().generateEmailVerificationLink(email),
          8000,
          'firebase generateEmailVerificationLink'
        );
        const continueUrl = new URL('/auth/login', handlerUrl).toString();
        const actionUrl = buildEmailVerificationHandlerUrl({
          handlerUrl,
          firebaseActionLink: firebaseLink,
          email,
          continueUrl,
        });

        await sendEmailVerificationEmail({
          to: email,
          name: userName,
          actionUrl,
          expiresAt: issue.expiresAt,
          idempotencyKey: `email-verification-${issue.requestId}`,
        });
      } catch (deliveryError) {
        await deleteEmailVerificationRequest(issue.requestId);
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
    const idToken = String(req.body?.idToken ?? '').trim();
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
      let firebaseVerified = false;
      if (idToken) {
        try {
          const decoded = await withTimeout(
            admin.auth().verifyIdToken(idToken),
            8000,
            'firebase verifyIdToken email verification check'
          );
          const tokenEmail = String(decoded.email ?? '').trim().toLowerCase();
          if (!tokenEmail) {
            return this.errorWithCode(
              req,
              res,
              400,
              'EMAIL_TOKEN_MISSING_EMAIL',
              'Token de email invalido.',
              false
            );
          }

          if (tokenEmail !== email) {
            return this.errorWithCode(
              req,
              res,
              403,
              'EMAIL_TOKEN_MISMATCH',
              'Token de email nao corresponde ao usuario informado.',
              false
            );
          }

          firebaseVerified = decoded.email_verified === true;
        } catch (providerError: any) {
          if (
            providerError?.code === 'auth/id-token-expired' ||
            providerError?.code === 'auth/argument-error'
          ) {
            return this.errorWithCode(
              req,
              res,
              401,
              'EMAIL_TOKEN_INVALID',
              'Sessao de verificacao expirada. Reenvie o email e tente novamente.',
              false
            );
          }
          console.error('Falha ao verificar status no provedor de email:', providerError);
          return this.errorWithCode(
            req,
            res,
            503,
            'DEPENDENCY_UNAVAILABLE',
            'Servico temporariamente indisponivel. Tente novamente em instantes.',
            true
          );
        }
      } else {
        return this.errorWithCode(
          req,
          res,
          400,
          'EMAIL_TOKEN_REQUIRED',
          'Token de verificacao e obrigatorio.',
          false
        );
      }

      const status = await checkEmailVerificationStatus({
        email,
        isVerified: firebaseVerified,
      });

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
          INSERT INTO users (firebase_uid, name, email, password_hash, phone, street, number, complement, bairro, city, state, cep)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          firebaseUid,
          name,
          email,
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
          SELECT u.id, u.name, u.email, u.password_hash, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep,
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
        `SELECT u.id, u.name, u.email, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep, u.firebase_uid, u.token_version,
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

