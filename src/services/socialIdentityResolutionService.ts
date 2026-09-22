import { ConflictError } from '../errors/ApplicationError';

export type SocialIdentityUser = {
  id: number;
  firebase_uid?: string | null;
};

export type SocialIdentityResolver<TUser extends SocialIdentityUser> = {
  findByFirebaseUid: (firebaseUid: string) => Promise<TUser | null>;
  findByEmail: (email: string) => Promise<TUser | null>;
  linkFirebaseUidIfEmpty?: (userId: number, firebaseUid: string) => Promise<boolean>;
};

function socialIdentityConflict(): ConflictError {
  return new ConflictError(
    'Não foi possível associar esta conta social a uma conta existente.',
    { code: 'SOCIAL_IDENTITY_CONFLICT', retryable: false },
  );
}

/**
 * Resolves a Firebase social identity without merging accounts implicitly.
 *
 * The Firebase UID is authoritative. Email is only a compatibility path for
 * pre-existing accounts that do not yet have a Firebase UID.
 */
export async function resolveSocialIdentity<TUser extends SocialIdentityUser>(
  input: {
    firebaseUid: string;
    email: string;
  },
  resolver: SocialIdentityResolver<TUser>,
): Promise<TUser | null> {
  const userByUid = await resolver.findByFirebaseUid(input.firebaseUid);
  const userByEmail = await resolver.findByEmail(input.email);

  if (userByUid && userByEmail && userByUid.id !== userByEmail.id) {
    throw socialIdentityConflict();
  }

  if (!userByUid && userByEmail && resolver.linkFirebaseUidIfEmpty) {
    const existingFirebaseUid = String(userByEmail.firebase_uid ?? '').trim();
    if (existingFirebaseUid && existingFirebaseUid !== input.firebaseUid) {
      throw socialIdentityConflict();
    }

    const linked = await resolver.linkFirebaseUidIfEmpty(userByEmail.id, input.firebaseUid);
    if (!linked) {
      throw socialIdentityConflict();
    }
    userByEmail.firebase_uid = input.firebaseUid;
  }

  return userByUid ?? userByEmail;
}
