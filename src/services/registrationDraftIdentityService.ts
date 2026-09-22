import admin from '../config/firebaseAdmin';
import { ConflictError, UnauthorizedError, InvalidInputError } from '../errors/ApplicationError';
import type { RegistrationDraftRow } from './registrationDraftRepository';

export type DraftIdentityInput = {
  idToken?: unknown;
  firebaseIdToken?: unknown;
  googleIdToken?: unknown;
  googleUid?: unknown;
  firebaseUid?: unknown;
  email?: unknown;
  authProvider?: unknown;
};

type VerifiedDraftIdentity = {
  firebaseUid: string;
  email: string;
  provider: 'google';
};

export function requiresSocialIdentity(input: DraftIdentityInput): boolean {
  return [input.idToken, input.firebaseIdToken, input.googleIdToken,
    input.googleUid, input.firebaseUid].some(value => value != null && value !== '')
    || (input.authProvider != null && input.authProvider !== 'email');
}

export function assertDraftIdentityMatches(input: DraftIdentityInput, identity: VerifiedDraftIdentity) {
  const uidMismatch = [input.googleUid, input.firebaseUid].some(
    uid => uid != null && uid !== '' && uid !== identity.firebaseUid,
  );
  const emailMismatch = input.email != null && input.email !== ''
    && String(input.email).trim().toLowerCase() !== identity.email;
  // "firebase" is the legacy transport label, never the source of the provider.
  const providerMismatch = input.authProvider != null
    && !['google', 'firebase'].includes(String(input.authProvider));
  if (uidMismatch || emailMismatch || providerMismatch) {
    throw new ConflictError('Os dados do cadastro não correspondem à identidade social comprovada.', {
      code: 'SOCIAL_IDENTITY_MISMATCH',
    });
  }
}

export async function verifyDraftSocialIdentity(input: DraftIdentityInput): Promise<VerifiedDraftIdentity & {
  name?: string;
  phone?: string;
}> {
  const token = input.idToken ?? input.firebaseIdToken ?? input.googleIdToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw new UnauthorizedError('Confirme sua identidade com um token Firebase válido.', {
      code: 'SOCIAL_IDENTITY_TOKEN_REQUIRED',
    });
  }
  let claims;
  try {
    claims = await admin.auth().verifyIdToken(token.trim());
  } catch {
    throw new UnauthorizedError('Token Firebase inválido ou expirado.', { code: 'SOCIAL_IDENTITY_TOKEN_INVALID' });
  }
  if (claims.firebase?.sign_in_provider !== 'google.com') {
    throw new InvalidInputError('Provider social não suportado neste cadastro.', {
      code: 'SOCIAL_IDENTITY_PROVIDER_UNSUPPORTED',
    });
  }
  if (!claims.uid || !claims.email || claims.email_verified !== true) {
    throw new UnauthorizedError('O token deve comprovar o UID e um e-mail verificado.', {
      code: 'SOCIAL_IDENTITY_TOKEN_INVALID',
    });
  }
  const identity: VerifiedDraftIdentity = {
    firebaseUid: claims.uid,
    email: claims.email.trim().toLowerCase(),
    provider: 'google',
  };
  assertDraftIdentityMatches(input, identity);
  return { ...identity, name: claims.name, phone: claims.phone_number };
}

export function draftIdentityUpdates(identity: VerifiedDraftIdentity) {
  return {
    authProvider: identity.provider,
    firebaseUid: identity.firebaseUid,
    googleUid: identity.firebaseUid,
    email: identity.email,
    // Written only by the backend after verification; never store the bearer token.
    providerMetadata: { verifiedSocialIdentity: {
      version: 1, firebaseUid: identity.firebaseUid, email: identity.email, provider: identity.provider,
    } },
  };
}

export function readVerifiedDraftIdentity(draft: RegistrationDraftRow): VerifiedDraftIdentity {
  let metadata;
  try {
    metadata = typeof draft.provider_metadata === 'string'
      ? JSON.parse(draft.provider_metadata) : draft.provider_metadata;
  } catch { /* Old drafts require fresh proof, without losing their profile data. */ }
  const identity = metadata?.verifiedSocialIdentity;
  if (identity?.version !== 1 || identity.provider !== 'google'
    || !identity.firebaseUid || !identity.email
    || draft.firebase_uid !== identity.firebaseUid || draft.google_uid !== identity.firebaseUid
    || draft.email !== identity.email || draft.auth_provider !== identity.provider) {
    throw new UnauthorizedError('Confirme novamente a identidade social deste rascunho.', {
      code: 'SOCIAL_IDENTITY_TOKEN_REQUIRED',
    });
  }
  return identity;
}
