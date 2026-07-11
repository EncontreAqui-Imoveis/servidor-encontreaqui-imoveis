export type NegotiationActorRecord = {
  proposer_id?: number | string | null;
  advertiser_id?: number | string | null;
};

function normalizeUserId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isNegotiationAdmin(role: unknown): boolean {
  return String(role ?? '').trim().toLowerCase() === 'admin';
}

export function isNegotiationActor(userId: unknown, negotiation: NegotiationActorRecord): boolean {
  const actorId = normalizeUserId(userId);
  return actorId !== null && (
    actorId === normalizeUserId(negotiation.proposer_id)
    || actorId === normalizeUserId(negotiation.advertiser_id)
  );
}
