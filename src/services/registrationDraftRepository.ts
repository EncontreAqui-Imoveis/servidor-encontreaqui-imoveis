import crypto from 'crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { authDb } from './authPersistenceService';

export type DraftProfileType = 'client' | 'broker';
export type DraftStatus = 'OPEN' | 'COMPLETED' | 'DISCARDED' | 'EXPIRED';
export type DraftStep =
  | 'IDENTITY'
  | 'CONTACT'
  | 'ADDRESS'
  | 'VERIFICATION'
  | 'FINALIZE_CHOICE'
  | 'FINALIZE_READY'
  | 'DONE';
export type DraftAuthProvider = 'email' | 'google' | 'firebase';

export interface RegistrationDraftRow extends RowDataPacket {
  id: number;
  draft_id: string;
  draft_token_hash: string;
  status: DraftStatus;
  profile_type: DraftProfileType;
  email: string;
  email_normalized: string;
  name: string | null;
  phone: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  without_number: number;
  creci: string | null;
  auth_provider: DraftAuthProvider;
  google_uid: string | null;
  firebase_uid: string | null;
  provider_aud: string | null;
  provider_metadata: string | null;
  email_verified_at: string | Date | null;
  phone_verified_at: string | Date | null;
  password_hash: string | null;
  password_hash_expires_at: string | Date | null;
  current_step: DraftStep;
  revision: number;
  expires_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
  completed_at: string | Date | null;
  discarded_at: string | Date | null;
  user_id: number | null;
}

export interface DraftPhoneOtpRow extends RowDataPacket {
  id: number;
  draft_id: number;
  phone: string;
  session_token: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  cooldown_seconds: number;
  sent_at: string | Date;
  expires_at: string | Date;
  consumed_at: string | Date | null;
  invalidated: number;
}

export interface DraftDocumentRow extends RowDataPacket {
  id: number;
  draft_id: number;
  creci_front_url: string;
  creci_back_url: string;
  selfie_url: string;
  status: 'UPLOADED' | 'PENDING' | 'INVALID';
  created_at: string | Date;
  updated_at: string | Date;
}

const TOKEN_LIFETIME_MINUTES = 1440;
const DRAFT_ID_PREFIX = 'draft-';
const DRAFT_TOKEN_BYTES = 32;

export function nowDate(): Date {
  return new Date();
}

export function draftExpiryAt(base: Date = nowDate()): Date {
  return new Date(base.getTime() + TOKEN_LIFETIME_MINUTES * 60 * 1000);
}

export function generateDraftId(): string {
  return `${DRAFT_ID_PREFIX}${crypto.randomUUID()}`;
}

export function generateDraftToken(): string {
  return crypto.randomBytes(DRAFT_TOKEN_BYTES).toString('hex');
}

export function hashDraftToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeBoolean(value: unknown): number {
  return value === true ? 1 : 0;
}

export async function createDraft(
  payload: {
    draftId: string;
    draftTokenHash: string;
    email: string;
    profileType: DraftProfileType;
    name?: string | null;
    phone?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    bairro?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
    withoutNumber?: boolean;
    creci?: string | null;
    authProvider?: DraftAuthProvider;
    googleUid?: string | null;
    firebaseUid?: string | null;
    providerAud?: string | null;
    providerMetadata?: Record<string, unknown> | null;
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
    passwordHash?: string | null;
    passwordHashExpiresAt?: Date | null;
    currentStep?: DraftStep;
    expiresAt?: Date;
  }
): Promise<RegistrationDraftRow> {
  const now = nowDate();
  const expiresAt = payload.expiresAt ?? draftExpiryAt(now);
  const currentStep: DraftStep = payload.currentStep ?? 'IDENTITY';

  await authDb.query(
    `
      INSERT INTO registration_drafts (
        draft_id,
        draft_token_hash,
        status,
        profile_type,
        email,
        name,
        phone,
        street,
        number,
        complement,
        bairro,
        city,
        state,
        cep,
        without_number,
        creci,
        auth_provider,
        google_uid,
        firebase_uid,
        provider_aud,
        provider_metadata,
        email_verified_at,
        phone_verified_at,
        password_hash,
        password_hash_expires_at,
        current_step,
        expires_at
      ) VALUES (
        ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `,
    [
      payload.draftId,
      payload.draftTokenHash,
      payload.profileType,
      payload.email.trim().toLowerCase(),
      payload.name?.trim() || null,
      payload.phone?.trim() || null,
      payload.street?.trim() || null,
      payload.number?.trim() || null,
      payload.complement?.trim() || null,
      payload.bairro?.trim() || null,
      payload.city?.trim() || null,
      payload.state?.trim() || null,
      payload.cep?.trim() || null,
      normalizeBoolean(payload.withoutNumber),
      payload.creci?.trim() || null,
      payload.authProvider || 'email',
      payload.googleUid || null,
      payload.firebaseUid || null,
      payload.providerAud || null,
      payload.providerMetadata ? JSON.stringify(payload.providerMetadata) : null,
      payload.emailVerifiedAt || null,
      payload.phoneVerifiedAt || null,
      payload.passwordHash || null,
      payload.passwordHashExpiresAt || null,
      currentStep,
      expiresAt,
    ]
  );

  const draft = await getDraftByDraftId(payload.draftId);
  if (!draft) {
    throw new Error('Falha ao recuperar draft criado.');
  }
  return draft;
}

export async function getDraftByDraftId(draftId: string): Promise<RegistrationDraftRow | null> {
  const [rows] = await authDb.query<RegistrationDraftRow[]>(
    'SELECT * FROM registration_drafts WHERE draft_id = ? LIMIT 1',
    [draftId],
  );
  return rows[0] ?? null;
}

export async function getDraftByDraftIdAndTokenForUpdate(
  draftId: string,
  draftTokenHash: string,
): Promise<RegistrationDraftRow | null> {
  const [rows] = await authDb.query<RegistrationDraftRow[]>(
    `
      SELECT *
      FROM registration_drafts
      WHERE draft_id = ? AND draft_token_hash = ? AND status = 'OPEN'
      FOR UPDATE
      LIMIT 1
    `,
    [draftId, draftTokenHash],
  );
  return rows[0] ?? null;
}

export async function getDraftByDraftIdAndToken(
  draftId: string,
  draftTokenHash: string,
): Promise<RegistrationDraftRow | null> {
  const [rows] = await authDb.query<RegistrationDraftRow[]>(
    `
      SELECT
        id,
        draft_id,
        draft_token_hash,
        status,
        profile_type,
        email,
        email_normalized,
        name,
        phone,
        street,
        number,
        complement,
        bairro,
        city,
        state,
        cep,
        without_number,
        creci,
        auth_provider,
        google_uid,
        firebase_uid,
        provider_aud,
        provider_metadata,
        email_verified_at,
        phone_verified_at,
        password_hash,
        password_hash_expires_at,
        current_step,
        revision,
        expires_at,
        created_at,
        updated_at,
        completed_at,
        discarded_at,
        user_id
      FROM registration_drafts
      WHERE draft_id = ? AND draft_token_hash = ? AND status = 'OPEN'
      LIMIT 1
    `,
    [draftId, draftTokenHash],
  );
  return rows[0] ?? null;
}

export async function findOpenDraftByEmail(email: string): Promise<RegistrationDraftRow | null> {
  const [rows] = await authDb.query<RegistrationDraftRow[]>(
    `
      SELECT *
      FROM registration_drafts
      WHERE LOWER(TRIM(email)) = ? AND status = 'OPEN'
      LIMIT 1
    `,
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function updateDraftByDraftId(
  draftId: string,
  draftTokenHash: string,
  updates: {
    name?: string | null;
    phone?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    bairro?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
    withoutNumber?: boolean;
    creci?: string | null;
    currentStep?: DraftStep;
    emailVerifiedAt?: Date | null;
    phoneVerifiedAt?: Date | null;
    passwordHash?: string | null;
    passwordHashExpiresAt?: Date | null;
    profileType?: DraftProfileType;
    authProvider?: DraftAuthProvider;
    googleUid?: string | null;
    firebaseUid?: string | null;
    providerMetadata?: Record<string, unknown> | null;
    status?: DraftStatus;
    completedAt?: Date | null;
    discardedAt?: Date | null;
    userId?: number | null;
    revisionIncrement?: boolean;
  },
): Promise<void> {
  const set: string[] = [];
  const values: unknown[] = [];

  const push = (column: string, value: unknown) => {
    set.push(`${column} = ?`);
    values.push(value);
  };

  if (Object.prototype.hasOwnProperty.call(updates, 'name')) push('name', updates.name ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'phone')) push('phone', updates.phone ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'street')) push('street', updates.street ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'number')) push('number', updates.number ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'complement')) push('complement', updates.complement ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'bairro')) push('bairro', updates.bairro ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'city')) push('city', updates.city ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'state')) push('state', updates.state ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'cep')) push('cep', updates.cep ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'withoutNumber')) push('without_number', normalizeBoolean(updates.withoutNumber));
  if (Object.prototype.hasOwnProperty.call(updates, 'creci')) push('creci', updates.creci ?? null);
  if (Object.prototype.hasOwnProperty.call(updates, 'currentStep')) push('current_step', updates.currentStep);
  if (Object.prototype.hasOwnProperty.call(updates, 'emailVerifiedAt')) push('email_verified_at', updates.emailVerifiedAt);
  if (Object.prototype.hasOwnProperty.call(updates, 'phoneVerifiedAt')) push('phone_verified_at', updates.phoneVerifiedAt);
  if (Object.prototype.hasOwnProperty.call(updates, 'passwordHash')) push('password_hash', updates.passwordHash);
  if (Object.prototype.hasOwnProperty.call(updates, 'passwordHashExpiresAt')) push('password_hash_expires_at', updates.passwordHashExpiresAt);
  if (Object.prototype.hasOwnProperty.call(updates, 'profileType')) push('profile_type', updates.profileType);
  if (Object.prototype.hasOwnProperty.call(updates, 'authProvider')) push('auth_provider', updates.authProvider);
  if (Object.prototype.hasOwnProperty.call(updates, 'googleUid')) push('google_uid', updates.googleUid);
  if (Object.prototype.hasOwnProperty.call(updates, 'firebaseUid')) push('firebase_uid', updates.firebaseUid);
  if (Object.prototype.hasOwnProperty.call(updates, 'providerMetadata')) {
    push('provider_metadata', updates.providerMetadata ? JSON.stringify(updates.providerMetadata) : null);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'status')) push('status', updates.status);
  if (Object.prototype.hasOwnProperty.call(updates, 'completedAt')) push('completed_at', updates.completedAt);
  if (Object.prototype.hasOwnProperty.call(updates, 'discardedAt')) push('discarded_at', updates.discardedAt);
  if (Object.prototype.hasOwnProperty.call(updates, 'userId')) push('user_id', updates.userId);

  if (updates.revisionIncrement) {
    set.push('revision = revision + 1');
  }

  if (set.length === 0) {
    return;
  }

  const query = `
    UPDATE registration_drafts
    SET ${set.join(', ')}
    WHERE draft_id = ? AND draft_token_hash = ? AND status = 'OPEN'
  `;
  values.push(draftId, draftTokenHash);
  await authDb.query<ResultSetHeader>(query, values);
}

export async function discardExpiredDrafts(): Promise<number> {
  const now = nowDate();
  const [result] = await authDb.query<ResultSetHeader>(
    `
      UPDATE registration_drafts
      SET
        status = 'EXPIRED',
        password_hash = NULL,
        password_hash_expires_at = NULL
      WHERE status = 'OPEN' AND expires_at <= ?
    `,
    [now],
  );
  await authDb.query<ResultSetHeader>(
    `
      UPDATE registration_phone_otps
      SET invalidated = 1
      WHERE draft_id IN (
        SELECT id FROM registration_drafts WHERE status = 'EXPIRED' AND expires_at <= ?
      )
    `,
    [now],
  );
  await authDb.query<ResultSetHeader>(
    `
      DELETE FROM registration_draft_documents
      WHERE draft_id IN (
        SELECT id FROM registration_drafts WHERE status = 'EXPIRED' AND expires_at <= ?
      )
    `,
    [now],
  );
  await authDb.query<ResultSetHeader>(
    `
      UPDATE email_code_challenges
      SET status = 'expired'
      WHERE draft_id IN (
        SELECT id FROM registration_drafts WHERE status = 'EXPIRED' AND expires_at <= ?
      )
    `,
    [now],
  );
  return result.affectedRows;
}

export async function upsertDraftPhoneOtp(params: {
  draftId: number;
  phone: string;
  sessionToken: string;
  codeHash: string;
  cooldownSeconds?: number;
  expiresAt: Date;
}) : Promise<void> {
  await authDb.query(
    `
      UPDATE registration_phone_otps
      SET invalidated = 1
      WHERE draft_id = ? AND invalidated = 0
    `,
    [params.draftId],
  );
  await authDb.query(
    `
      INSERT INTO registration_phone_otps (
        draft_id,
        phone,
        session_token,
        code_hash,
        cooldown_seconds,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      params.draftId,
      params.phone,
      params.sessionToken,
      params.codeHash,
      params.cooldownSeconds ?? 60,
      params.expiresAt,
    ],
  );
}

export async function getDraftPhoneOtpBySessionToken(sessionToken: string): Promise<DraftPhoneOtpRow | null> {
  const [rows] = await authDb.query<DraftPhoneOtpRow[]>(
    `
      SELECT *
      FROM registration_phone_otps
      WHERE session_token = ?
      LIMIT 1
    `,
    [sessionToken],
  );
  return rows[0] ?? null;
}

export async function useDraftPhoneOtp(sessionToken: string): Promise<void> {
  await authDb.query<ResultSetHeader>(
    `
      UPDATE registration_phone_otps
      SET invalidated = 1, consumed_at = NOW()
      WHERE session_token = ?
    `,
    [sessionToken],
  );
}

export async function upsertDraftDocuments(params: {
  draftId: number;
  creciFrontUrl: string;
  creciBackUrl: string;
  selfieUrl: string;
  status?: 'UPLOADED' | 'PENDING' | 'INVALID';
}): Promise<void> {
  await authDb.query<ResultSetHeader>(
    `
      INSERT INTO registration_draft_documents (
        draft_id,
        creci_front_url,
        creci_back_url,
        selfie_url,
        status
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        creci_front_url = VALUES(creci_front_url),
        creci_back_url = VALUES(creci_back_url),
        selfie_url = VALUES(selfie_url),
        status = VALUES(status),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      params.draftId,
      params.creciFrontUrl,
      params.creciBackUrl,
      params.selfieUrl,
      params.status ?? 'UPLOADED',
    ],
  );
}

export async function getDraftDocuments(draftId: number): Promise<DraftDocumentRow | null> {
  const [rows] = await authDb.query<DraftDocumentRow[]>(
    'SELECT * FROM registration_draft_documents WHERE draft_id = ? LIMIT 1',
    [draftId],
  );
  return rows[0] ?? null;
}

