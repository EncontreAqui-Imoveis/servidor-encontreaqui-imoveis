import { processOneDueAccountDeletionRequest } from './accountDeletionCompletionService';

const DEFAULT_WORKER_INTERVAL_MS = 60 * 1000;
const MAX_REQUESTS_PER_CYCLE = 10;

let accountDeletionWorkerTimer: NodeJS.Timeout | null = null;
let accountDeletionWorkerRunning = false;

function isTrue(value: unknown): boolean {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

export function isAccountDeletionWorkerEnabled(): boolean {
  return isTrue(process.env.ACCOUNT_DELETION_WORKER_ENABLED);
}

/** Processes a bounded batch so account deletion work cannot monopolize HTTP. */
export async function runAccountDeletionWorkerCycle(
  maxRequests = MAX_REQUESTS_PER_CYCLE,
): Promise<void> {
  for (let index = 0; index < maxRequests; index += 1) {
    const result = await processOneDueAccountDeletionRequest();
    if (!result.claimed || !result.completed) return;
  }
}

export function setupAccountDeletionWorker(
  intervalMs = DEFAULT_WORKER_INTERVAL_MS,
): (() => void) | null {
  if (!isAccountDeletionWorkerEnabled()) return null;
  if (accountDeletionWorkerTimer) return () => undefined;

  const tick = () => {
    if (accountDeletionWorkerRunning) return;
    accountDeletionWorkerRunning = true;
    void runAccountDeletionWorkerCycle()
      .catch(() => {
        console.warn('Falha no ciclo de exclusão de contas.', {
          code: 'ACCOUNT_DELETION_WORKER_CYCLE_FAILED',
        });
      })
      .finally(() => {
        accountDeletionWorkerRunning = false;
      });
  };

  tick();
  accountDeletionWorkerTimer = setInterval(tick, intervalMs);
  return () => {
    if (accountDeletionWorkerTimer) {
      clearInterval(accountDeletionWorkerTimer);
      accountDeletionWorkerTimer = null;
    }
  };
}
