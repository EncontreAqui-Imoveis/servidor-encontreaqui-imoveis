export type NegotiationInitiatorSide = 'buyer' | 'seller';

function normalizePositiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The listing broker is the publishing account. The owner account is an
 * explicit fallback when a property is published without a broker.
 */
export function resolveAdvertiserIdFromProperty(input: {
  brokerId: unknown;
  ownerId: unknown;
}): number | null {
  return normalizePositiveId(input.brokerId) ?? normalizePositiveId(input.ownerId);
}

export function resolveNegotiationInitiatorSide(input: {
  proposerId: unknown;
  advertiserId: unknown;
  propertyOwnerId: unknown;
}): NegotiationInitiatorSide {
  const proposerId = normalizePositiveId(input.proposerId);
  const advertiserId = normalizePositiveId(input.advertiserId);
  const propertyOwnerId = normalizePositiveId(input.propertyOwnerId);

  return proposerId != null && (proposerId === advertiserId || proposerId === propertyOwnerId)
    ? 'seller'
    : 'buyer';
}
