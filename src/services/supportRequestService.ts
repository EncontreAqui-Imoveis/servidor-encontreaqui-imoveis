export const SUPPORT_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface SupportRequestCooldownResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function evaluateSupportRequestCooldown(
  lastRequestAt: Date | null,
  now: Date = new Date(),
): SupportRequestCooldownResult {
  if (!lastRequestAt) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const elapsedMs = now.getTime() - lastRequestAt.getTime();
  if (elapsedMs >= SUPPORT_REQUEST_COOLDOWN_MS) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const remainingMs = SUPPORT_REQUEST_COOLDOWN_MS - elapsedMs;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
  };
}
