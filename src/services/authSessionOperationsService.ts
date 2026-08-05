import bcrypt from 'bcryptjs';
import { RowDataPacket } from 'mysql2';
import admin from '../config/firebaseAdmin';
import {
  GatewayTimeoutError,
  InternalError,
  InvalidInputError,
  NotFoundError,
  UnauthorizedError,
  UnavailableError,
  isApplicationError,
} from '../errors/ApplicationError';
import { authDb } from './authPersistenceService';
import {
  buildUserPayload,
  hasCompleteProfile,
  requiresBrokerDocuments,
  signUserToken,
  type ProfileType,
  withTimeout,
} from './authSessionService';

type AuthUserRow = RowDataPacket & {
  id: number;
  name?: string | null;
  email?: string | null;
  cpf?: string | null;
  email_verified_at?: string | null;
  password_hash?: string | null;
  phone?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  bairro?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
  token_version?: number | null;
  role?: string | null;
  broker_id?: number | null;
  broker_status?: string | null;
  broker_profile_type?: string | null;
  creci?: string | null;
  broker_documents_status?: string | null;
  firebase_uid?: string | null;
};

export interface LoginInput {
  email?: string;
  password?: string;
}

export interface LoginResult {
  user: ReturnType<typeof buildUserPayload>;
  token: string;
  needsCompletion: boolean;
  requiresDocuments: boolean;
}

export interface GoogleInput {
  idToken?: string;
  profileType?: string;
  requestId?: string | null;
}

export interface GoogleResult {
  user?: ReturnType<typeof buildUserPayload>;
  token?: string;
  needsCompletion: boolean;
  requiresDocuments: boolean;
  blockedBrokerRequest?: boolean;
  roleLocked: boolean;
  isNewUser: boolean;
  requestedProfile: ProfileType | 'auto';
  requiresProfileChoice?: boolean;
  pending?: {
    email: string;
    name: string;
    googleUid: string;
  };
}

export interface LogoutInput {
  userId?: number;
}

export interface LogoutResult {
  message: string;
}

function normalizeRequestedProfile(value: unknown): ProfileType | 'auto' {
  if (value === 'broker') {
    return 'broker';
  }
  if (value === 'client') {
    return 'client';
  }
  return 'auto';
}

const columnExistsCache = new Map<string, Promise<boolean>>();

function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const cached = columnExistsCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = authDb
    .query<RowDataPacket[]>(
      `
        SELECT 1
          FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1
      `,
      [table, column],
    )
    .then(([rows]) => rows.length > 0)
    .catch((error) => {
      // Missing tables return an empty result from information_schema. A
      // connection/query failure must remain visible instead of looking like a
      // legacy schema, otherwise every login degrades into a misleading 500.
      columnExistsCache.delete(key);
      throw error;
    });

  columnExistsCache.set(key, promise);
  return promise;
}

type ErrorMetadata = {
  code?: unknown;
  errno?: unknown;
  sqlState?: unknown;
};

function errorCode(error: unknown): string {
  const value = (error as ErrorMetadata | null)?.code;
  return typeof value === 'string' ? value.trim() : '';
}

function isDatabaseError(error: unknown): boolean {
  const metadata = error as ErrorMetadata | null;
  const code = errorCode(error);
  return (
    code.startsWith('ER_') ||
    typeof metadata?.errno === 'number' ||
    typeof metadata?.sqlState === 'string'
  );
}

function isInvalidFirebaseTokenError(error: unknown): boolean {
  return new Set([
    'auth/argument-error',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/invalid-id-token',
  ]).has(errorCode(error));
}

function isFirebaseServiceError(error: unknown): boolean {
  const code = errorCode(error);
  return code.startsWith('auth/') || code.startsWith('app/');
}

function logGoogleAuthFailure(
  stage: string,
  requestId: string | null | undefined,
  error: unknown,
): void {
  const normalized = error instanceof Error ? error : null;
  console.error('Google auth failure:', {
    stage,
    requestId: requestId ?? null,
    errorName: normalized?.name ?? 'UnknownError',
    errorCode: errorCode(error) || null,
    databaseError: isDatabaseError(error),
  });
}

type UserSelectQuery = {
  selectClause: string;
  brokerDocumentsJoin: string;
};

async function buildUserSelectQuery(): Promise<UserSelectQuery> {
  const hasCpfColumn = await hasColumn('users', 'cpf');
  const hasFirebaseUidColumn = await hasColumn('users', 'firebase_uid');
  // Bancos legados podem nao ter a tabela de documentos do corretor. O login
  // continua valido; apenas o status documental fica indisponivel nesse caso.
  const hasBrokerDocumentsStatus = await hasColumn('broker_documents', 'status');

  return {
    selectClause: [
    'u.id',
    'u.name',
    'u.email',
    hasCpfColumn ? 'u.cpf' : 'NULL AS cpf',
    'u.email_verified_at',
    'u.password_hash',
    'u.phone',
    'u.street',
    'u.number',
    'u.complement',
    'u.bairro',
    'u.city',
    'u.state',
    'u.cep',
    'u.token_version',
    hasFirebaseUidColumn ? 'u.firebase_uid' : 'NULL AS firebase_uid',
    `CASE
       WHEN b.id IS NOT NULL AND b.status IN ('approved', 'pending_verification') AND COALESCE(b.profile_type, 'BROKER') = 'AUXILIARY_ADMINISTRATIVE' THEN 'auxiliary_administrative'
       WHEN b.id IS NOT NULL AND b.status IN ('approved', 'pending_verification') THEN 'broker'
       ELSE 'client'
     END AS role`,
    'b.id AS broker_id',
    'b.status AS broker_status',
    'b.profile_type AS broker_profile_type',
    'b.creci AS creci',
      hasBrokerDocumentsStatus
        ? 'bd.status AS broker_documents_status'
        : 'NULL AS broker_documents_status',
    ].join(', '),
    brokerDocumentsJoin: hasBrokerDocumentsStatus
      ? 'LEFT JOIN broker_documents bd ON b.id = bd.broker_id'
      : '',
  };
}

function mapProfile(row: AuthUserRow): ProfileType {
  return row.role === 'auxiliary_administrative'
    ? 'auxiliary_administrative'
    : row.role === 'broker'
      ? 'broker'
      : 'client';
}

function mapGoogleProfile(row: AuthUserRow): ProfileType {
  const brokerStatus = String(row.broker_status ?? '').trim();
  const blockedBrokerRequest = brokerStatus === 'rejected';
  const isBroker =
    row.broker_id != null &&
    !blockedBrokerRequest &&
    (brokerStatus === 'approved' || brokerStatus === 'pending_verification');
  const brokerProfileType = String(row.broker_profile_type ?? 'BROKER').toUpperCase();

  return isBroker
    ? brokerProfileType === 'AUXILIARY_ADMINISTRATIVE'
      ? 'auxiliary_administrative'
      : 'broker'
    : 'client';
}

export async function login(input: LoginInput): Promise<LoginResult> {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');

  if (!email || !password) {
    throw new InvalidInputError('Email e senha são obrigatórios.');
  }

  try {
    const userSelectQuery = await buildUserSelectQuery();
    const [rows] = await authDb.query<AuthUserRow[]>(
      `
        SELECT ${userSelectQuery.selectClause}
        FROM users u
        LEFT JOIN brokers b ON u.id = b.id
        ${userSelectQuery.brokerDocumentsJoin}
        WHERE u.email = ?
      `,
      [email],
    );

    if (rows.length === 0) {
      throw new UnauthorizedError('Credenciais inválidas.');
    }

    const user = rows[0];
    const passwordHash = user.password_hash != null ? String(user.password_hash) : '';
    if (!passwordHash) {
      throw new UnauthorizedError('Credenciais inválidas.');
    }

    const isPasswordCorrect = await bcrypt.compare(password, passwordHash);
    if (!isPasswordCorrect) {
      throw new UnauthorizedError('Credenciais inválidas.');
    }

    const profile = mapProfile(user);
    const brokerDocsStatus = String(user.broker_documents_status ?? '').trim().toLowerCase();
    const requiresDocuments =
      profile === 'broker' &&
      requiresBrokerDocuments(user.broker_status, brokerDocsStatus);
    const token = signUserToken(user.id, profile, user.token_version);

    return {
      user: buildUserPayload(user, profile),
      token,
      needsCompletion: !hasCompleteProfile(user),
      requiresDocuments,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof InvalidInputError) {
      throw error;
    }
    console.error('Erro no login:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}

export async function google(input: GoogleInput): Promise<GoogleResult> {
  const idToken = String(input.idToken ?? '').trim();
  if (!idToken) {
    throw new InvalidInputError('idToken do Google é obrigatório.');
  }

  const requestedProfile = normalizeRequestedProfile(input.profileType);
  const requestId = input.requestId;
  let stage = 'firebase_verify';

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
      throw new InvalidInputError('Email não disponível no token do Google.');
    }

    stage = 'schema_probe';
    const userSelectQuery = await buildUserSelectQuery();
    const hasFirebaseUidColumn = await hasColumn('users', 'firebase_uid');
    const lookupWhere = hasFirebaseUidColumn
      ? 'WHERE u.firebase_uid = ? OR u.email = ?'
      : 'WHERE u.email = ?';
    const lookupParams = hasFirebaseUidColumn ? [uid, email] : [email];
    stage = 'user_lookup';
    const [existingRows] = await authDb.query<AuthUserRow[]>(
      `SELECT ${userSelectQuery.selectClause}
         FROM users u
         LEFT JOIN brokers b ON u.id = b.id
         ${userSelectQuery.brokerDocumentsJoin}
        ${lookupWhere}
        LIMIT 1`,
      lookupParams,
    );

    if (existingRows.length === 0) {
      return {
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
        requestedProfile,
      };
    }

    const row = existingRows[0];
    stage = 'profile_update';
    if (hasFirebaseUidColumn && !row.firebase_uid) {
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
    const brokerDocsStatus = String(row.broker_documents_status ?? '').trim().toLowerCase();
    const blockedBrokerRequest = brokerStatus === 'rejected';
    const effectiveProfile = mapGoogleProfile(row);
    const requiresDocuments =
      effectiveProfile === 'broker' &&
      requiresBrokerDocuments(brokerStatus, brokerDocsStatus);
    stage = 'session_issue';
    const token = signUserToken(row.id, effectiveProfile, row.token_version);

    return {
      user: buildUserPayload(row, effectiveProfile),
      token,
      needsCompletion: !hasCompleteProfile(row),
      requiresDocuments,
      blockedBrokerRequest,
      roleLocked: blockedBrokerRequest || effectiveProfile === 'broker',
      isNewUser: false,
      requestedProfile,
    };
  } catch (error) {
    if (isApplicationError(error)) {
      throw error;
    }
    if (error instanceof Error && error.message.includes('Timeout while waiting for')) {
      logGoogleAuthFailure(stage, requestId, error);
      throw new GatewayTimeoutError('A autenticação com Google demorou demais. Tente novamente.', {
        code: 'GOOGLE_AUTH_TIMEOUT',
        retryable: true,
      });
    }
    logGoogleAuthFailure(stage, requestId, error);
    if (isInvalidFirebaseTokenError(error)) {
      throw new UnauthorizedError('Não foi possível validar sua sessão com o Google. Faça login novamente.', {
        code: 'GOOGLE_TOKEN_INVALID',
        retryable: false,
      });
    }
    if (isDatabaseError(error)) {
      throw new UnavailableError('Não foi possível acessar sua conta agora. Tente novamente.', {
        code: 'AUTH_STORAGE_UNAVAILABLE',
        retryable: true,
      });
    }
    if (isFirebaseServiceError(error)) {
      throw new UnavailableError('A autenticação com Google está temporariamente indisponível. Tente novamente.', {
        code: 'GOOGLE_AUTH_UNAVAILABLE',
        retryable: true,
      });
    }
    throw new InternalError('Erro ao autenticar com Google.', {
      code: 'GOOGLE_AUTH_INTERNAL',
      retryable: false,
    });
  }
}

export async function logout(input: LogoutInput): Promise<LogoutResult> {
  const userId = Number(input.userId);

  if (!Number.isFinite(userId) || userId <= 0) {
    throw new UnauthorizedError('Usuário não autenticado.');
  }

  try {
    const [result] = await authDb.query(
      'UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = ?',
      [userId],
    );

    if (typeof result === 'object' && result != null && 'affectedRows' in result && Number((result as { affectedRows?: number }).affectedRows ?? 0) === 0) {
      throw new NotFoundError('Usuário não encontrado.');
    }

    return { message: 'Logout realizado com sucesso.' };
  } catch (error) {
    if (error instanceof UnauthorizedError || error instanceof NotFoundError) {
      throw error;
    }

    const errorCode = (error as { code?: string } | null)?.code;
    if (errorCode === 'ER_BAD_FIELD_ERROR') {
      return { message: 'Logout realizado com sucesso.' };
    }

    console.error('Erro no logout:', error);
    throw new InternalError('Erro interno do servidor.');
  }
}
