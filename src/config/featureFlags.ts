/**
 * Feature flag operational for dual auth flow rollout.
 * - true / undefined / empty: mantém endpoints draft ativos.
 * - false/0/off/no/disable/disabled: desativa fluxo de rascunho e
 *   força /users/auth/firebase a seguir o caminho legado.
 */
export function isDraftRegistrationEnabled(): boolean {
  const rawValue = process.env.AUTH_DRAFT_FLOW_ENABLED;
  if (rawValue === undefined || rawValue === null) {
    return true;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  return !['0', 'false', 'off', 'disable', 'disabled', 'no'].includes(normalized);
}
