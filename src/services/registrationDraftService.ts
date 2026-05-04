import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { authDb } from './authPersistenceService';
import {
  createDraft as insertDraftRecord,
  getDraftByDraftIdAndToken,
  updateDraftByDraftId,
  upsertDraftPhoneOtp,
  getDraftPhoneOtpBySessionToken,
  useDraftPhoneOtp,
  upsertDraftDocuments,
  findOpenDraftByEmail,
  discardExpiredDrafts,
  DraftProfileType,
  DraftStep,
  DraftAuthProvider,
  RegistrationDraftRow,
  getDraftByDraftId,
} from './registrationDraftRepository';
import { hashDraftToken, generateDraftId, generateDraftToken, nowDate, draftExpiryAt } from './registrationDraftRepository';
import {
  sanitizeAddressInput,
  sanitizePartialAddressInput,
  AddressFields,
} from '../utils/address';
import { hasValidCreci, normalizeCreci } from '../utils/creci';
import { buildUserPayload, signUserToken, hasCompleteProfile } from './authSessionService';
import {
  issueEmailCodeChallenge,
  verifyEmailCode,
  deleteEmailCodeChallenge,
} from './emailCodeChallengeService';
import { sendEmailCodeEmail } from './emailService';
import firebaseAdmin from '../config/firebaseAdmin';

export type DraftFinalizeAction = 'send_later' | 'submit_documents';

const PHONE_OTP_TTL_SECONDS = 5 * 60;
const PHONE_MAX_ATTEMPTS = 5;
const PHONE_COOLDOWN_SECONDS = 60;
const PASSWORD_TTL_MINUTES = 60;
type DraftPhoneVerificationMode = 'firebase' | 'legacy' | 'unavailable';
type PhoneOtpDeliveryResult =
  | { ok: true; provider: string; status: 'sent' | 'mock' }
  | { ok: false; provider: string; status: 'disabled' | 'mock' | 'unsupported' | 'error' };
type DraftFinalizeLegalAcceptance = {
  acceptedTerms?: unknown;
  acceptedPrivacyPolicy?: unknown;
  acceptedBrokerAgreement?: unknown;
  termsVersion?: unknown;
  privacyPolicyVersion?: unknown;
  brokerAgreementVersion?: unknown;
};
type DraftFinalizeRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};
type DraftLegalAcceptanceType = 'terms' | 'privacy' | 'broker_agreement';
type ResolvedDraftLegalAcceptance = {
  type: DraftLegalAcceptanceType;
  version: string;
  acceptedAt: Date;
};

type QueryExecutor = {
  query: typeof authDb.query;
};

function toLegalAcceptanceBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeLegalAcceptanceVersion(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveDraftLegalAcceptances(
  profileType: DraftProfileType,
  action: DraftFinalizeAction,
  payload: DraftFinalizeLegalAcceptance,
): ResolvedDraftLegalAcceptance[] {
  const acceptedTerms = toLegalAcceptanceBoolean(payload.acceptedTerms);
  const termsVersion = normalizeLegalAcceptanceVersion(payload.termsVersion);
  if (!acceptedTerms || !termsVersion) {
    throw new DraftFlowError(400, 'TERMS_ACCEPTANCE_REQUIRED', 'Aceite dos termos de uso e obrigatorio.');
  }

  const acceptedPrivacy = toLegalAcceptanceBoolean(payload.acceptedPrivacyPolicy);
  const privacyVersion = normalizeLegalAcceptanceVersion(payload.privacyPolicyVersion);
  if (!acceptedPrivacy || !privacyVersion) {
    throw new DraftFlowError(400, 'PRIVACY_ACCEPTANCE_REQUIRED', 'Aceite da politica de privacidade e obrigatorio.');
  }

  const requiresBrokerAgreement =
    profileType === 'broker' && (action === 'send_later' || action === 'submit_documents');
  let brokerAgreementVersion = '';
  if (requiresBrokerAgreement) {
    const acceptedBrokerAgreement = toLegalAcceptanceBoolean(payload.acceptedBrokerAgreement);
    brokerAgreementVersion = normalizeLegalAcceptanceVersion(payload.brokerAgreementVersion);
    if (!acceptedBrokerAgreement || !brokerAgreementVersion) {
      throw new DraftFlowError(
        400,
        'BROKER_AGREEMENT_REQUIRED',
        'Aceite do contrato de adesao de corretor e obrigatorio.',
      );
    }
  }

  const acceptedAt = now();
  const acceptances: ResolvedDraftLegalAcceptance[] = [
    {
      type: 'terms',
      version: termsVersion,
      acceptedAt,
    },
    {
      type: 'privacy',
      version: privacyVersion,
      acceptedAt,
    },
  ];

  if (requiresBrokerAgreement && brokerAgreementVersion) {
    acceptances.push({
      type: 'broker_agreement',
      version: brokerAgreementVersion,
      acceptedAt,
    });
  }

  return acceptances;
}

function normalizeRequestContextValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function persistDraftLegalAcceptances(
  db: QueryExecutor,
  userId: number,
  acceptances: ResolvedDraftLegalAcceptance[],
  ip: string | null,
  userAgent: string | null,
) {
  if (acceptances.length === 0) {
    return;
  }

  for (const acceptance of acceptances) {
    await db.query<ResultSetHeader>(
      `
        INSERT INTO user_legal_acceptances (
          user_id,
          type,
          version,
          accepted_at,
          ip,
          user_agent
        ) VALUES (?, ?, ?, ?, ?, ?)
      `,
      [userId, acceptance.type, acceptance.version, acceptance.acceptedAt, ip, userAgent],
    );
  }
}

function resolvePhoneOtpProvider(): string {
  const provider = String(
    process.env.PHONE_OTP_PROVIDER ??
      process.env.DRAFT_VERIFY_PHONE_PROVIDER ??
      process.env.DRAFT_PHONE_OTP_PROVIDER ??
      '',
  )
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim()
    .toLowerCase();
  if (!provider) {
    return 'disabled';
  }
  return provider;
}

function buildPhoneVerificationDiagnostic() {
  return {
    provider: resolvePhoneOtpProvider(),
    envNodeEnv: String(process.env.NODE_ENV ?? '').trim(),
    hasDraftVerifyPhoneProvider: Boolean(process.env.DRAFT_VERIFY_PHONE_PROVIDER),
    hasPhoneOtpProvider: Boolean(process.env.PHONE_OTP_PROVIDER),
    hasDraftPhoneOtpProvider: Boolean(process.env.DRAFT_PHONE_OTP_PROVIDER),
    hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    hasFirebaseClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
    hasFirebasePrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
  };
}

function resolveDraftPhoneVerificationMode(): DraftPhoneVerificationMode {
  const provider = resolvePhoneOtpProvider();
  if (provider === 'firebase') {
    return 'firebase';
  }

  if (String(process.env.NODE_ENV ?? '').toLowerCase() === 'test') {
    return 'legacy';
  }

  if (provider === 'mock' || provider === 'custom' || provider === 'test' || provider === 'noop') {
    return 'legacy';
  }

  return 'unavailable';
}

function extractFirebasePhoneFromTokenClaims(claims: unknown): string {
  if (!claims || typeof claims !== 'object') {
    return '';
  }

  const payload = claims as {
    phone_number?: unknown;
    phoneNumber?: unknown;
    phone?: unknown;
    [key: string]: unknown;
  };

  return normalizePhone(payload.phone_number ?? payload.phoneNumber ?? payload.phone ?? '');
}

async function dispatchDraftPhoneOtp(
  draftId: string,
  _phone: string,
  _code: string,
): Promise<PhoneOtpDeliveryResult> {
  const provider = resolvePhoneOtpProvider();
  const draftIdSuffix = draftId.slice(-6);

  if (process.env.NODE_ENV === 'test') {
    return { ok: true, provider: provider || 'test', status: 'sent' };
  }

  if (provider === 'disabled') {
    console.warn('[draft.verify-phone] provider nao configurado', {
      draftIdSuffix,
      provider: 'disabled',
      status: 'not-dispatched',
    });
    return { ok: false, provider: 'disabled', status: 'disabled' };
  }

  if (provider === 'mock' || provider === 'noop') {
    console.warn('[draft.verify-phone] provider em modo mock/no-op', {
      draftIdSuffix,
      provider,
      status: 'not-dispatched',
    });
    return { ok: false, provider, status: 'mock' };
  }

  if (provider === 'log' || provider === 'console') {
    console.info('[draft.verify-phone] provider somente para logs', {
      draftIdSuffix,
      provider,
      status: 'not-dispatched',
    });
    return { ok: false, provider, status: 'unsupported' };
  }

  if (provider === 'sms' || provider === 'twilio' || provider === 'aws_sns' || provider === 'nexmo') {
    // TODO: integrar provider real de SMS
    console.error('[draft.verify-phone] provider SMS nao implementado no backend', {
      draftIdSuffix,
      provider,
      status: 'not-dispatched',
    });
    return { ok: false, provider, status: 'unsupported' };
  }

  console.error('[draft.verify-phone] provider desconhecido', {
    draftIdSuffix,
    provider,
    status: 'not-dispatched',
  });
  return { ok: false, provider, status: 'unsupported' };
}

export class DraftFlowError extends Error {
  statusCode: number;
  code: string;
  retryAfterSeconds?: number;
  fields?: string[];
  constructor(
    statusCode: number,
    code: string,
    message: string,
    retryAfterSeconds?: number,
    fields?: string[],
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.fields = fields;
  }
}

function normalizeToken(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeDraftStep(value: unknown): DraftStep {
  const raw = String(value ?? '').trim().toUpperCase();
  const allowed: DraftStep[] = [
    'IDENTITY',
    'CONTACT',
    'ADDRESS',
    'VERIFICATION',
    'FINALIZE_CHOICE',
    'FINALIZE_READY',
    'DONE',
  ];
  return allowed.includes(raw as DraftStep) ? (raw as DraftStep) : 'IDENTITY';
}

function normalizeProfileType(value: unknown): DraftProfileType {
  return String(value || '').trim().toLowerCase() === 'broker' ? 'broker' : 'client';
}

function normalizeDraftAuthProvider(value: unknown): DraftAuthProvider {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'google') return 'google';
  if (raw === 'firebase') return 'firebase';
  return 'email';
}

function now(): Date {
  return nowDate();
}

function hashToken(raw: string): string {
  return hashDraftToken(raw);
}

function normalizeDraftTextValue(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : null;
}

function buildCreateDraftAddressInput(input: {
  street?: unknown;
  number?: unknown;
  complement?: unknown;
  bairro?: unknown;
  city?: unknown;
  state?: unknown;
  cep?: unknown;
  withoutNumber?: unknown;
}) {
  const values: {
    street?: string;
    number?: string;
    complement?: string;
    bairro?: string;
    city?: string;
    state?: string;
    cep?: string;
    withoutNumber?: unknown;
  } = {};

  const street = normalizeDraftTextValue(input.street);
  const number = normalizeDraftTextValue(input.number);
  const complement = normalizeDraftTextValue(input.complement);
  const bairro = normalizeDraftTextValue(input.bairro);
  const city = normalizeDraftTextValue(input.city);
  const state = normalizeDraftTextValue(input.state);
  const cep = normalizeDraftTextValue(input.cep);

  if (street) values.street = street;
  if (number) values.number = number;
  if (complement) values.complement = complement;
  if (bairro) values.bairro = bairro;
  if (city) values.city = city;
  if (state) values.state = state;
  if (cep) values.cep = cep;
  if (input.withoutNumber !== undefined && (input.withoutNumber === true || Object.keys(values).length > 0)) {
    values.withoutNumber = input.withoutNumber;
  }
  if (
    !('withoutNumber' in values)
    && isWithoutNumberText(input.number)
    && !('withoutNumber' in input)
  ) {
    values.withoutNumber = true;
  }

  return values;
}

function isWithoutNumberText(value: unknown): boolean {
  const text = normalizeDraftTextValue(value);
  if (!text) {
    return false;
  }
  return /^(s\/?n|sn)$/i.test(text.replace(/\s+/g, ''));
}

function normalizePhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeNumericCode(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function draftPayload(draft: RegistrationDraftRow) {
  return {
    draftId: draft.draft_id,
    profileType: draft.profile_type,
    email: draft.email,
    name: draft.name,
    phone: draft.phone,
    street: draft.street,
    number: draft.number,
    complement: draft.complement,
    bairro: draft.bairro,
    city: draft.city,
    state: draft.state,
    cep: draft.cep,
    withoutNumber: !!draft.without_number,
    creci: draft.creci,
    status: draft.status,
    currentStep: draft.current_step,
    needsEmailVerification: draft.email_verified_at == null,
    needsPhoneVerification: draft.phone_verified_at == null,
    expiresAt: draft.expires_at instanceof Date
      ? draft.expires_at.toISOString()
      : new Date(draft.expires_at).toISOString(),
  };
}

type ParsedAddressPayload = {
  ok: true;
  value: Partial<AddressFields>;
} | {
  ok: false;
  errors: string[];
};

function parseAddressBody(body: {
  street?: unknown;
  number?: unknown;
  complement?: unknown;
  bairro?: unknown;
  city?: unknown;
  state?: unknown;
  cep?: unknown;
  withoutNumber?: unknown;
}, partial = false): ParsedAddressPayload {
  const hasWithoutNumberFlag =
    Object.prototype.hasOwnProperty.call(body, 'withoutNumber')
    || Object.prototype.hasOwnProperty.call(body, 'without_number');
  const sanitizedBody = Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== undefined),
  ) as {
    street?: unknown;
    number?: unknown;
    complement?: unknown;
    bairro?: unknown;
    city?: unknown;
    state?: unknown;
    cep?: unknown;
    withoutNumber?: unknown;
    without_number?: unknown;
  };
  const payload = {
    ...sanitizedBody,
    ...(isWithoutNumberText(sanitizedBody.number) && !('withoutNumber' in sanitizedBody)
      && !('without_number' in sanitizedBody)
      ? { withoutNumber: true }
      : {}),
  };
  if (partial) {
    const partialInput = {
      ...(payload.street !== undefined ? { street: payload.street } : {}),
      ...(payload.number !== undefined ? { number: payload.number } : {}),
      ...(payload.complement !== undefined ? { complement: payload.complement } : {}),
      ...(payload.bairro !== undefined ? { bairro: payload.bairro } : {}),
      ...(payload.city !== undefined ? { city: payload.city } : {}),
      ...(payload.state !== undefined ? { state: payload.state } : {}),
      ...(payload.cep !== undefined ? { cep: payload.cep } : {}),
      ...(payload.withoutNumber !== undefined ? { withoutNumber: payload.withoutNumber } : {}),
    };
    const parsed = sanitizePartialAddressInput(partialInput);
    if (!parsed.ok && !hasWithoutNumberFlag) {
      const parsedWithoutWithoutNumber = sanitizePartialAddressInput(
        Object.fromEntries(
          Object.entries(partialInput).filter(([key]) => key !== 'withoutNumber'),
        ),
      );
      if (parsedWithoutWithoutNumber.ok) {
        return parsedWithoutWithoutNumber;
      }
      const errors = parsedWithoutWithoutNumber.errors.filter((field) => field !== 'without_number');
      return { ok: false, errors };
    }
    return parsed;
  }
  return sanitizeAddressInput({
    street: payload.street,
    number: payload.number,
    complement: payload.complement,
    bairro: payload.bairro,
    city: payload.city,
    state: payload.state,
    cep: payload.cep,
    ...(payload.withoutNumber !== undefined ? { without_number: payload.withoutNumber } : {}),
  }, { requireCep: false });
}

function resolveDraftErrorStatus(status: string) {
  return status === 'OPEN' ? null : 'DRAFT_NOT_OPEN';
}

function normalizeDraftResponse(draft: RegistrationDraftRow | null): RegistrationDraftRow {
  if (!draft) {
    throw new DraftFlowError(401, 'DRAFT_NOT_FOUND', 'Rascunho nao encontrado.');
  }
  if (resolveDraftErrorStatus(draft.status)) {
    const expiresAt = new Date(draft.expires_at);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
      throw new DraftFlowError(410, 'DRAFT_EXPIRED', 'Rascunho expirado.');
    }
    throw new DraftFlowError(409, 'DRAFT_NOT_OPEN', 'Rascunho nao esta aberto.');
  }
  return draft;
}

async function resolveDraftContext(draftId: string, rawDraftToken: unknown): Promise<{
  draft: RegistrationDraftRow;
  draftTokenHash: string;
}> {
  const token = normalizeToken(rawDraftToken);
  if (!draftId || !token) {
    throw new DraftFlowError(401, 'DRAFT_TOKEN_REQUIRED', 'Token de rascunho nao informado.');
  }
  const draftTokenHash = hashToken(token);
  const draft = normalizeDraftResponse(await getDraftByDraftIdAndToken(draftId, draftTokenHash));
  const expiresAt = new Date(draft.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
    await updateDraftByDraftId(draftId, draftTokenHash, { status: 'EXPIRED' });
    throw new DraftFlowError(410, 'DRAFT_EXPIRED', 'Rascunho expirado.');
  }
  return { draft, draftTokenHash };
}

export async function createRegistrationDraft(input: {
  email: string;
  name: string;
  password?: string;
  phone?: string;
  street?: unknown;
  number?: unknown;
  complement?: unknown;
  bairro?: unknown;
  city?: unknown;
  state?: unknown;
  cep?: unknown;
  withoutNumber?: unknown;
  profileType?: DraftProfileType;
  creci?: unknown;
  authProvider?: DraftAuthProvider;
  googleUid?: string | null;
  firebaseUid?: string | null;
  currentStep?: DraftStep;
}) {
  await discardExpiredDrafts();
  const email = normalizeEmail(input.email);
  const name = String(input.name ?? '').trim();
  if (!email || !name) {
    throw new DraftFlowError(400, 'DRAFT_INVALID_INPUT', 'Email e nome sao obrigatorios.');
  }
  const profileType = normalizeProfileType(input.profileType);
  const normalizedProvider = normalizeDraftAuthProvider(input.authProvider);
  const password = String(input.password ?? '');
  if (normalizedProvider === 'email' && password.trim().length < 6) {
    throw new DraftFlowError(400, 'DRAFT_PASSWORD_INVALID', 'Senha obrigatoria com 6 caracteres no minimo.');
  }

  const [existingUsers] = await authDb.query<RowDataPacket[]>(
    'SELECT id FROM users WHERE email = ? LIMIT 1',
    [email],
  );
  if (existingUsers.length > 0) {
    throw new DraftFlowError(409, 'EMAIL_ALREADY_EXISTS', 'Este email ja esta em uso.');
  }
  const existingDraft = await findOpenDraftByEmail(email);
  if (existingDraft) {
    throw new DraftFlowError(409, 'DRAFT_ALREADY_EXISTS', 'Ja existe um fluxo de cadastro para este email.');
  }

  const normalizedCreci = normalizeCreci(input.creci);
  if (profileType === 'broker' && !hasValidCreci(normalizedCreci)) {
    throw new DraftFlowError(400, 'DRAFT_CRICI_INVALID', 'CRECI invalido.');
  }
  if (profileType === 'broker') {
    const [existingCreci] = await authDb.query<RowDataPacket[]>(
      'SELECT id FROM brokers WHERE creci = ? LIMIT 1',
      [normalizedCreci],
    );
    if (existingCreci.length > 0) {
      throw new DraftFlowError(409, 'CRECI_ALREADY_EXISTS', 'Este CRECI ja esta em uso.');
    }
  }

  const createDraftAddress = buildCreateDraftAddressInput(input);
  const addressPayload = Object.keys(createDraftAddress).length > 0
    ? parseAddressBody(createDraftAddress, true)
    : null;
  if (addressPayload && !addressPayload.ok) {
    throw new DraftFlowError(
      400,
      'DRAFT_ADDRESS_INVALID',
      'Endereco invalido.',
      undefined,
      addressPayload.errors,
    );
  }

  const passwordHash = normalizedProvider === 'email' ? await bcrypt.hash(password, 8) : null;
  const passwordHashExpiresAt = passwordHash
    ? new Date(now().getTime() + PASSWORD_TTL_MINUTES * 60 * 1000)
    : null;
  const draftId = generateDraftId();
  const draftToken = generateDraftToken();
  const draftTokenHash = hashToken(draftToken);
  const draft = await insertDraftRecord({
    draftId,
    draftTokenHash,
    email,
    profileType,
    name,
    phone: input.phone,
    street: addressPayload?.value.street,
    number: addressPayload?.value.number,
    complement: addressPayload?.value.complement,
    bairro: addressPayload?.value.bairro,
    city: addressPayload?.value.city,
    state: addressPayload?.value.state,
    cep: addressPayload?.value.cep,
    withoutNumber: !!input.withoutNumber,
    creci: profileType === 'broker' ? normalizedCreci : null,
    authProvider: normalizedProvider,
    googleUid: input.googleUid,
    firebaseUid: input.firebaseUid,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
    passwordHash,
    passwordHashExpiresAt,
    currentStep: normalizeDraftStep(input.currentStep ?? 'IDENTITY'),
    expiresAt: draftExpiryAt(now()),
  });

  return {
    draftId,
    draftToken,
    draft: draftPayload(draft),
    expiresAtMinutes: 1440,
  };
}

export async function patchRegistrationDraft(
  draftId: string,
  rawDraftToken: unknown,
  body: {
    name?: string | null;
    phone?: string | null;
    street?: unknown;
    number?: unknown;
    complement?: unknown;
    bairro?: unknown;
    city?: unknown;
    state?: unknown;
    cep?: unknown;
    withoutNumber?: unknown;
    creci?: unknown;
    currentStep?: DraftStep;
  },
) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  const updates: {
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
  } = {};

  if (Object.prototype.hasOwnProperty.call(body, 'name')) updates.name = body.name ?? null;
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) updates.phone = body.phone ?? null;
  if (Object.prototype.hasOwnProperty.call(body, 'currentStep')) {
    updates.currentStep = normalizeDraftStep(body.currentStep);
  }
  if (draft.profile_type === 'broker' && Object.prototype.hasOwnProperty.call(body, 'creci')) {
    const creci = normalizeCreci(body.creci);
    if (!hasValidCreci(creci)) {
      throw new DraftFlowError(400, 'DRAFT_CRICI_INVALID', 'CRECI invalido.');
    }
    updates.creci = creci;
  }
  const patchAddressInput = buildCreateDraftAddressInput(body);
  if (Object.keys(patchAddressInput).length > 0) {
    const addr = parseAddressBody(patchAddressInput, true);
    if (!addr.ok) {
      throw new DraftFlowError(
        400,
        'DRAFT_ADDRESS_INVALID',
        'Endereco invalido.',
        undefined,
        addr.errors,
      );
    }
    updates.street = addr.value.street;
    updates.number = addr.value.number;
    updates.complement = addr.value.complement;
    updates.bairro = addr.value.bairro;
    updates.city = addr.value.city;
    updates.state = addr.value.state;
    updates.cep = addr.value.cep;
    updates.withoutNumber = body.withoutNumber === undefined ? isWithoutNumberText(addr.value.number) : !!body.withoutNumber;
  }

  if (Object.keys(updates).length > 0) {
    await updateDraftByDraftId(draftId, draftTokenHash, updates);
    const reloaded = await getDraftByDraftIdAndToken(draftId, draftTokenHash);
    return draftPayload(normalizeDraftResponse(reloaded));
  }

  return draftPayload(draft);
}

export async function getRegistrationDraft(draftId: string, rawDraftToken: unknown) {
  const { draft } = await resolveDraftContext(draftId, rawDraftToken);
  return draftPayload(draft);
}

export async function sendDraftEmailVerificationCode(draftId: string, rawDraftToken: unknown) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);

  let issue;
  try {
    issue = await issueEmailCodeChallenge({
      email: draft.email,
      purpose: 'verify_email',
      draftId: draft.id,
      draftTokenHash,
      draftStep: 1,
    });
  } catch (error) {
    console.error('Falha ao registrar desafio de código para rascunho:', error);
    throw new DraftFlowError(503, 'EMAIL_CODE_CHALLENGE_FAILED', 'Falha temporária ao enviar o codigo de verificacao.');
  }

  if (!issue.allowed) {
    throw new DraftFlowError(429, issue.code, `Aguarde ${issue.retryAfterSeconds}s para reenviar.`);
  }

  const retryAfterSeconds = 0;

  try {
    await sendEmailCodeEmail({
      to: draft.email,
      purpose: 'verify_email',
      code: issue.code,
      expiresAt: issue.expiresAt,
      idempotencyKey: `draft-${draft.id}-verify-${issue.requestId}`,
    });
  } catch (error) {
    await deleteEmailCodeChallenge(issue.requestId);
    throw new DraftFlowError(503, 'EMAIL_PROVIDER_ERROR', 'Servico de email temporariamente indisponivel.');
  }

  return {
    sentAt: now().toISOString(),
    expiresAt: issue.expiresAt.toISOString(),
    cooldownSec: issue.cooldownSec,
    retryAfterSeconds,
    resendType: issue.resendType,
  };
}

export async function confirmDraftEmailCode(
  draftId: string,
  rawDraftToken: unknown,
  code: unknown,
) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  const normalizedCode = normalizeNumericCode(code);
  const db = await authDb.getConnection();
  let committed = false;
  try {
    await db.beginTransaction();
    const result = await verifyEmailCode(
      {
        email: draft.email,
        code: normalizedCode,
        draftId: draft.id,
        draftTokenHash,
      },
      {
        db,
        consumeCode: false,
      },
    );

    if (result.status === 'verified') {
      await updateDraftByDraftId(draftId, draftTokenHash, { emailVerifiedAt: result.verifiedAt }, db);
      await db.query<ResultSetHeader>(
        `
          UPDATE email_code_challenges
          SET status = 'verified', verified_at = ?
          WHERE id = ?
        `,
        [result.verifiedAt, result.challengeId],
      );
      await db.commit();
      committed = true;
      return {
        status: 'verified',
        verifiedAt: result.verifiedAt.toISOString(),
      };
    }

    await db.commit();
    committed = true;

    if (result.status === 'expired') {
      throw new DraftFlowError(410, 'EMAIL_CODE_EXPIRED', 'Codigo de verificacao expirado.');
    }
    if (result.status === 'locked') {
      throw new DraftFlowError(423, 'EMAIL_CODE_LOCKED', 'Codigo bloqueado por excesso de tentativas.');
    }
    if (result.status === 'invalid') {
      throw new DraftFlowError(400, 'EMAIL_CODE_INVALID', 'Codigo invalido.');
    }

    throw new DraftFlowError(400, 'EMAIL_CODE_MISSING', 'Codigo de verificacao nao encontrado.');
  } catch (error) {
    if (!committed) {
      await db.rollback();
    }
    if (error instanceof DraftFlowError) {
      throw error;
    }
    throw new DraftFlowError(
      500,
      'EMAIL_CODE_CONFIRM_FAILED',
      'Nao foi possivel confirmar o codigo no momento.',
    );
  } finally {
    db.release();
  }
}

export async function requestDraftPhoneOtp(
  draftId: string,
  rawDraftToken: unknown,
  phone: unknown,
) {
  const logContext = buildPhoneVerificationDiagnostic();
  console.info('[draft.verify-phone] request start', logContext);
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new DraftFlowError(400, 'PHONE_REQUIRED', 'Telefone e obrigatorio.');
  }

  const verificationMode = resolveDraftPhoneVerificationMode();
  if (verificationMode === 'unavailable') {
    console.error('[draft.verify-phone] provider indisponivel', { ...logContext, outcome: 'unavailable', reason: 'PHONE_VERIFICATION_UNAVAILABLE' });
    throw new DraftFlowError(
      503,
      'PHONE_VERIFICATION_UNAVAILABLE',
      'Verificacao de telefone indisponivel no momento.',
    );
  }

  if (verificationMode === 'firebase') {
    await updateDraftByDraftId(draftId, draftTokenHash, {
      phone: normalizedPhone,
    });
    console.info('[draft.verify-phone] request outcome', { ...logContext, outcome: 'mode=firebase', draftStep: draft.current_step ?? null });
    return {
      mode: 'firebase',
      requiresFirebaseIdToken: true,
      phone: normalizedPhone,
    };
  }

  const [existingRows] = await authDb.query<RowDataPacket[]>(
    `
      SELECT sent_at, attempts, max_attempts, cooldown_seconds
      FROM registration_phone_otps
      WHERE draft_id = ? AND invalidated = 0
      ORDER BY sent_at DESC
      LIMIT 1
    `,
    [draft.id]
  );
  const latestOtp = existingRows[0] as
    | (RowDataPacket & { sent_at: string | Date; attempts: number; max_attempts: number; cooldown_seconds: number })
    | undefined;
  if (latestOtp) {
    const attempts = Number(latestOtp.attempts ?? 0);
    if (attempts >= PHONE_MAX_ATTEMPTS) {
      throw new DraftFlowError(423, 'PHONE_OTP_LOCKED', 'Tentativas excedidas.');
    }
    const cooldown = Number(latestOtp.cooldown_seconds ?? PHONE_COOLDOWN_SECONDS);
    const sentAt = latestOtp.sent_at instanceof Date ? latestOtp.sent_at : new Date(latestOtp.sent_at);
    const elapsed = Math.floor((now().getTime() - sentAt.getTime()) / 1000);
    if (elapsed < cooldown) {
      throw new DraftFlowError(429, 'PHONE_OTP_RATE_LIMITED', `Aguarde ${cooldown - elapsed}s para reenviar.`, cooldown - elapsed);
    }
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const sessionToken = crypto.randomUUID();
  const expiresAt = new Date(now().getTime() + PHONE_OTP_TTL_SECONDS * 1000);

  await upsertDraftPhoneOtp({
    draftId: draft.id,
    phone: normalizedPhone,
    sessionToken,
    codeHash,
    cooldownSeconds: PHONE_COOLDOWN_SECONDS,
    expiresAt,
  });

  const delivery = await dispatchDraftPhoneOtp(draft.draft_id, normalizedPhone, code);
  if (!delivery.ok) {
    await useDraftPhoneOtp(sessionToken);
    throw new DraftFlowError(
      503,
      'PHONE_OTP_DELIVERY_FAILED',
      `Nao foi possivel enviar o codigo por SMS (${delivery.status}).`,
    );
  }

  console.info('[draft.verify-phone] request outcome', { ...logContext, outcome: 'mode=legacy', draftStep: draft.current_step ?? null });

  if (process.env.NODE_ENV === 'test') {
    return {
      sessionToken,
      expiresAt: expiresAt.toISOString(),
      code,
    };
  }

  return {
    sessionToken,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function confirmDraftPhoneOtp(
  draftId: string,
  rawDraftToken: unknown,
  sessionToken: unknown,
  code: unknown,
  firebaseIdToken?: unknown,
) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  const verificationMode = resolveDraftPhoneVerificationMode();
  const normalizedFirebaseIdToken = normalizeToken(firebaseIdToken);

  if (verificationMode === 'firebase') {
    if (!normalizedFirebaseIdToken) {
      throw new DraftFlowError(
        400,
        'PHONE_FIREBASE_TOKEN_REQUIRED',
        'Token de autenticacao do Firebase e obrigatorio para confirmacao.',
      );
    }

    let claims: unknown;
    try {
      claims = await firebaseAdmin.auth().verifyIdToken(normalizedFirebaseIdToken);
    } catch {
      throw new DraftFlowError(401, 'PHONE_FIREBASE_TOKEN_INVALID', 'Token do Firebase invalido ou expirado.');
    }

    const phoneFromToken = extractFirebasePhoneFromTokenClaims(claims);
    if (!phoneFromToken) {
      throw new DraftFlowError(400, 'PHONE_FIREBASE_TOKEN_INVALID', 'Token do Firebase nao possui telefone.');
    }

    if (draft.phone && normalizePhone(draft.phone) !== phoneFromToken) {
      throw new DraftFlowError(
        409,
        'PHONE_MISMATCH',
        'Telefone informado nao confere com o token de autenticacao.',
      );
    }

    const nowTime = now();
    await updateDraftByDraftId(draftId, draftTokenHash, {
      phone: phoneFromToken,
      phoneVerifiedAt: nowTime,
      currentStep: 'VERIFICATION',
    });
    return { status: 'verified', phone: phoneFromToken };
  }

  if (verificationMode === 'unavailable') {
    console.error('[draft.verify-phone] confirm provider indisponivel', {
      draftIdSuffix: draft.draft_id.slice(-6),
      envNodeEnv: String(process.env.NODE_ENV ?? '').trim(),
      provider: resolvePhoneOtpProvider(),
      hasDraftVerifyPhoneProvider: Boolean(process.env.DRAFT_VERIFY_PHONE_PROVIDER),
      hasPhoneOtpProvider: Boolean(process.env.PHONE_OTP_PROVIDER),
      hasDraftPhoneOtpProvider: Boolean(process.env.DRAFT_PHONE_OTP_PROVIDER),
      hasFirebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
      hasFirebaseClientEmail: Boolean(process.env.FIREBASE_CLIENT_EMAIL),
      hasFirebasePrivateKey: Boolean(process.env.FIREBASE_PRIVATE_KEY),
      hasFirebaseServiceAccountPath: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_PATH),
    });
    throw new DraftFlowError(
      503,
      'PHONE_VERIFICATION_UNAVAILABLE',
      'Verificacao de telefone indisponivel no momento.',
    );
  }

  const otpCode = normalizeNumericCode(code);
  const normalizedSession = normalizeToken(sessionToken);

  const phoneOtpRow = await getDraftPhoneOtpBySessionToken(normalizedSession);
  if (!phoneOtpRow || phoneOtpRow.draft_id !== draft.id || phoneOtpRow.invalidated === 1) {
    throw new DraftFlowError(404, 'PHONE_SESSION_NOT_FOUND', 'Sessao de verificacao nao encontrada.');
  }
  const nowTime = now();
  const expiresAt = new Date(phoneOtpRow.expires_at instanceof Date ? phoneOtpRow.expires_at : String(phoneOtpRow.expires_at));
  if (expiresAt.getTime() <= nowTime.getTime()) {
    await useDraftPhoneOtp(normalizedSession);
    throw new DraftFlowError(410, 'PHONE_OTP_EXPIRED', 'Codigo de telefone expirado.');
  }

  const maxAttempts = Number(phoneOtpRow.max_attempts ?? PHONE_MAX_ATTEMPTS);
  const attempts = Number(phoneOtpRow.attempts ?? 0);
  const expectedHash = String(phoneOtpRow.code_hash ?? '');
  const incomingHash = crypto.createHash('sha256').update(otpCode).digest('hex');
  if (otpCode.length !== 6 || incomingHash !== expectedHash) {
    const nextAttempts = attempts + 1;
    await authDb.query<ResultSetHeader>(
      `
        UPDATE registration_phone_otps
        SET attempts = ?
        WHERE session_token = ?
      `,
      [nextAttempts, normalizedSession],
    );
    if (nextAttempts >= maxAttempts) {
      await authDb.query<ResultSetHeader>(
        `
          UPDATE registration_phone_otps
          SET invalidated = 1
          WHERE session_token = ?
        `,
        [normalizedSession],
      );
      throw new DraftFlowError(423, 'PHONE_OTP_LOCKED', 'Tentativas de codigo excedidas.');
    }
    const remaining = Math.max(0, maxAttempts - nextAttempts);
    throw new DraftFlowError(400, 'PHONE_OTP_INVALID', `Codigo invalido. Restam ${remaining} tentativas.`);
  }

  await useDraftPhoneOtp(normalizedSession);
  await updateDraftByDraftId(draftId, draftTokenHash, {
    phoneVerifiedAt: nowTime,
    phone: phoneOtpRow.phone,
    currentStep: 'VERIFICATION',
  });

  return { status: 'verified', phone: phoneOtpRow.phone };
}

export async function persistDraftDocuments(
  draftId: string,
  rawDraftToken: unknown,
  docs: {
    creciFrontUrl: string;
    creciBackUrl: string;
    selfieUrl: string;
  },
) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  if (draft.profile_type !== 'broker') {
    throw new DraftFlowError(403, 'BROKER_ONLY', 'Acoes de documentos so para brokers.');
  }

  if (!docs.creciFrontUrl || !docs.creciBackUrl || !docs.selfieUrl) {
    throw new DraftFlowError(400, 'DRAFT_DOCUMENTS_REQUIRED', 'Envie fotos da frente/verso do creci e selfie.');
  }

  await upsertDraftDocuments({
    draftId: draft.id,
    creciFrontUrl: docs.creciFrontUrl,
    creciBackUrl: docs.creciBackUrl,
    selfieUrl: docs.selfieUrl,
    status: 'UPLOADED',
  });
  await updateDraftByDraftId(draftId, draftTokenHash, { currentStep: 'FINALIZE_READY' });
  const reloaded = await getDraftByDraftIdAndToken(draftId, draftTokenHash);
  return draftPayload(normalizeDraftResponse(reloaded));
}

export async function finalizeRegistrationDraft(
  draftId: string,
  rawDraftToken: unknown,
  action: DraftFinalizeAction,
  legalAcceptance: DraftFinalizeLegalAcceptance = {},
  requestContext: DraftFinalizeRequestContext = {},
) {
  const token = normalizeToken(rawDraftToken);
  if (!token) {
    throw new DraftFlowError(401, 'DRAFT_TOKEN_REQUIRED', 'Token de rascunho nao informado.');
  }
  const draftTokenHash = hashToken(token);

  const draftRows = await getDraftByDraftIdAndToken(draftId, draftTokenHash);
  const draft = normalizeDraftResponse(draftRows);
  const expiresAt = new Date(draft.expires_at);
  if (expiresAt.getTime() <= now().getTime()) {
    await updateDraftByDraftId(draftId, draftTokenHash, { status: 'EXPIRED' });
    throw new DraftFlowError(410, 'DRAFT_EXPIRED', 'Rascunho expirado.');
  }
  if (draft.password_hash_expires_at) {
    const pwdExp = new Date(draft.password_hash_expires_at);
    if (!Number.isFinite(pwdExp.getTime()) || pwdExp.getTime() <= now().getTime()) {
      throw new DraftFlowError(410, 'DRAFT_PASSWORD_EXPIRED', 'Senha temporaria expirada.');
    }
  }

  const db = await authDb.getConnection();
  try {
    await db.beginTransaction();
    const [lockRows] = await db.query<any[]>(
      `
        SELECT *
        FROM registration_drafts
        WHERE id = (
          SELECT id
          FROM registration_drafts
          WHERE draft_id = ? AND draft_token_hash = ? AND status = 'OPEN'
          ORDER BY id DESC
          LIMIT 1
        )
        FOR UPDATE
      `,
      [draftId, draftTokenHash],
    );
    if (lockRows.length === 0) {
      await db.rollback();
      throw new DraftFlowError(409, 'DRAFT_NOT_OPEN', 'Rascunho nao esta aberto para finalizacao.');
    }

    const lockedDraft = lockRows[0] as RegistrationDraftRow;
    const lockedProfile = String(lockedDraft.profile_type || draft.profile_type) as DraftProfileType;
    const authProvider = String(lockedDraft.auth_provider || draft.auth_provider || 'email') as DraftAuthProvider;
    const acceptedLegal = resolveDraftLegalAcceptances(lockedProfile, action, legalAcceptance);
    if (lockedProfile === 'client' && authProvider === 'email' && !lockedDraft.password_hash) {
      await db.rollback();
      throw new DraftFlowError(400, 'DRAFT_PASSWORD_REQUIRED', 'Senha nao informada para cliente.');
    }

    const [userInsertResult] = await db.query<ResultSetHeader>(
      `
        INSERT INTO users (
          firebase_uid,
          name,
          email,
          email_verified_at,
          password_hash,
          phone,
          street,
          number,
          complement,
          bairro,
          city,
          state,
          cep
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        lockedDraft.firebase_uid,
        lockedDraft.name,
        lockedDraft.email,
        lockedDraft.email_verified_at ?? null,
        lockedDraft.password_hash,
        lockedDraft.phone,
        lockedDraft.street,
        lockedDraft.number,
        lockedDraft.complement,
        lockedDraft.bairro,
        lockedDraft.city,
        lockedDraft.state,
        lockedDraft.cep,
      ],
    );
    const userId = userInsertResult.insertId;

    await persistDraftLegalAcceptances(
      db,
      userId,
      acceptedLegal,
      normalizeRequestContextValue(requestContext.ip),
      normalizeRequestContextValue(requestContext.userAgent),
    );

    let requiresDocuments = false;
    let underReview = false;
    if (lockedProfile === 'broker') {
      if (!lockedDraft.creci) {
        await db.rollback();
        throw new DraftFlowError(400, 'DRAFT_CRICI_REQUIRED', 'CRECI obrigatorio para corretor.');
      }
      await db.query<ResultSetHeader>(
        'INSERT INTO brokers (id, creci, status) VALUES (?, ?, ?)',
        [userId, lockedDraft.creci, 'pending_verification'],
      );
      requiresDocuments = true;

      if (action === 'submit_documents') {
        underReview = true;
        const [docsRows] = await db.query<RowDataPacket[]>(
          'SELECT creci_front_url, creci_back_url, selfie_url FROM registration_draft_documents WHERE draft_id = ? LIMIT 1',
          [lockedDraft.id],
        );
        if (docsRows.length === 0) {
          await db.rollback();
          throw new DraftFlowError(400, 'DRAFT_DOCUMENTS_MISSING', 'Documentos de corretor sao obrigatorios.');
        }
        const docsRow = docsRows[0] as {
          creci_front_url: string;
          creci_back_url: string;
          selfie_url: string;
        };
        await db.query<ResultSetHeader>(
          'INSERT INTO broker_documents (broker_id, creci_front_url, creci_back_url, selfie_url, status) VALUES (?, ?, ?, ?, ?)',
          [userId, docsRow.creci_front_url, docsRow.creci_back_url, docsRow.selfie_url, 'pending'],
        );
      }
    }

    await db.query<ResultSetHeader>(
      `
        UPDATE registration_drafts
        SET
          status = 'COMPLETED',
          completed_at = NOW(),
          current_step = 'DONE',
          password_hash = NULL,
          password_hash_expires_at = NULL,
          user_id = ?
        WHERE draft_id = ? AND draft_token_hash = ?
      `,
      [userId, draftId, draftTokenHash],
    );
    await db.query<ResultSetHeader>(
      'DELETE FROM registration_draft_documents WHERE draft_id = ?',
      [lockedDraft.id],
    );
    await db.query<ResultSetHeader>(
      'DELETE FROM registration_phone_otps WHERE draft_id = ?',
      [lockedDraft.id],
    );
    await db.query<ResultSetHeader>(
      'DELETE FROM email_code_challenges WHERE draft_id = ?',
      [lockedDraft.id],
    );
    await db.commit();

    const [userRows] = await db.query<RowDataPacket[]>(`
      SELECT
        u.id, u.name, u.email, u.email_verified_at, u.phone, u.street, u.number, u.complement, u.bairro, u.city, u.state, u.cep,
        b.id AS broker_id, b.status AS broker_status, b.creci AS creci
      FROM users u
      LEFT JOIN brokers b ON u.id = b.id
      WHERE u.id = ?
    `, [userId]);
    const row = userRows[0];
    const profile = lockedProfile === 'broker' ? 'broker' : 'client';
    return {
      token: signUserToken(row.id, profile, 1),
      user: buildUserPayload({
        id: row.id,
        name: row.name,
        email: row.email,
        email_verified_at: row.email_verified_at,
        phone: row.phone,
        street: row.street,
        number: row.number,
        complement: row.complement,
        bairro: row.bairro,
        city: row.city,
        state: row.state,
        cep: row.cep,
        broker_id: row.broker_id,
        broker_status: row.broker_status,
        creci: row.creci,
      }, profile),
      needsCompletion: !hasCompleteProfile(row),
      requiresDocuments,
      underReview,
      action,
    };
  } catch (error) {
    await db.rollback();
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
      throw new DraftFlowError(409, 'DRAFT_DUPLICATE_ACCOUNT', 'Este email ou creci ja esta em uso.');
    }
    if (error instanceof DraftFlowError) throw error;
    throw error;
  } finally {
    db.release();
  }
}

export async function discardRegistrationDraft(draftId: string, rawDraftToken: unknown) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  await authDb.query(
    'DELETE FROM registration_draft_documents WHERE draft_id = ?',
    [draft.id],
  );
  await authDb.query(
    'UPDATE registration_phone_otps SET invalidated = 1 WHERE draft_id = ?',
    [draft.id],
  );
  await authDb.query(
    'DELETE FROM email_code_challenges WHERE draft_id = ?',
    [draft.id],
  );
  await updateDraftByDraftId(draftId, draftTokenHash, {
    status: 'DISCARDED',
    discardedAt: now(),
    passwordHash: null,
    passwordHashExpiresAt: null,
  });
  return {
    draftId: draft.draft_id,
    status: 'DISCARDED',
  };
}

export async function upsertFirebaseContextToDraft(
  draftId: string,
  rawDraftToken: unknown,
  context: {
    firebaseUid: string;
    withoutNumber?: unknown;
    without_number?: unknown;
    email?: unknown;
    name?: unknown;
    phone?: unknown;
    street?: unknown;
    number?: unknown;
    complement?: unknown;
    bairro?: unknown;
    city?: unknown;
    state?: unknown;
    cep?: unknown;
  },
) {
  const { draft, draftTokenHash } = await resolveDraftContext(draftId, rawDraftToken);
  const name = String(context.name ?? draft.name ?? '').trim() || draft.name;
  const updates: { [key: string]: unknown } = {
    authProvider: 'firebase',
    firebaseUid: context.firebaseUid,
    name,
  };
  if (context.phone !== undefined) {
    updates.phone = String(context.phone ?? '').trim();
  }
  if (context.email !== undefined) {
    updates.email = normalizeEmail(context.email);
  }
  const contextAddressInput = buildCreateDraftAddressInput(context as any);
  if (Object.keys(contextAddressInput).length > 0) {
    const addr = parseAddressBody(contextAddressInput, true);
    if (!addr.ok) {
      throw new DraftFlowError(
        400,
        'DRAFT_ADDRESS_INVALID',
        'Endereco invalido.',
        undefined,
        addr.errors,
      );
    }
    updates.street = addr.value.street;
    updates.number = addr.value.number;
    updates.complement = addr.value.complement;
    updates.bairro = addr.value.bairro;
    updates.city = addr.value.city;
    updates.state = addr.value.state;
    updates.cep = addr.value.cep;
    updates.withoutNumber = isWithoutNumberText(addr.value.number)
      || (context.withoutNumber ?? false);
  }

  await updateDraftByDraftId(draftId, draftTokenHash, updates as any);
  const reloaded = await getDraftByDraftId(draft.draft_id);
  return draftPayload(normalizeDraftResponse(reloaded));
}

