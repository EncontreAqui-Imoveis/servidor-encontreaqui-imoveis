import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { processOneDueAccountDeletionRequestMock } = vi.hoisted(() => ({
  processOneDueAccountDeletionRequestMock: vi.fn(),
}));

vi.mock('../../src/services/accountDeletionCompletionService', () => ({
  processOneDueAccountDeletionRequest: processOneDueAccountDeletionRequestMock,
}));

import {
  isAccountDeletionWorkerEnabled,
  runAccountDeletionWorkerCycle,
  setupAccountDeletionWorker,
} from '../../src/services/accountDeletionWorkerService';

const noRequest = { claimed: false, completed: false };
const completedRequest = { claimed: true, completed: true };

describe('accountDeletionWorkerService', () => {
  const originalEnabled = process.env.ACCOUNT_DELETION_WORKER_ENABLED;
  let stopWorker: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACCOUNT_DELETION_WORKER_ENABLED = originalEnabled;
    processOneDueAccountDeletionRequestMock.mockResolvedValue(noRequest);
  });

  afterEach(() => {
    stopWorker?.();
    stopWorker = null;
    vi.useRealTimers();
  });

  it('não inicia quando a flag está desligada', () => {
    delete process.env.ACCOUNT_DELETION_WORKER_ENABLED;

    expect(isAccountDeletionWorkerEnabled()).toBe(false);
    expect(setupAccountDeletionWorker()).toBeNull();
    expect(processOneDueAccountDeletionRequestMock).not.toHaveBeenCalled();
  });

  it('executa imediatamente quando a flag está ligada', async () => {
    process.env.ACCOUNT_DELETION_WORKER_ENABLED = 'true';

    stopWorker = setupAccountDeletionWorker();
    await vi.waitFor(() => {
      expect(processOneDueAccountDeletionRequestMock).toHaveBeenCalledOnce();
    });
    expect(stopWorker).toBeTypeOf('function');
  });

  it('evita sobreposição na mesma instância', async () => {
    vi.useFakeTimers();
    process.env.ACCOUNT_DELETION_WORKER_ENABLED = 'true';
    let resolveRequest: ((value: typeof noRequest) => void) | undefined;
    processOneDueAccountDeletionRequestMock.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    stopWorker = setupAccountDeletionWorker(60 * 1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(processOneDueAccountDeletionRequestMock).toHaveBeenCalledOnce();

    resolveRequest?.(noRequest);
    await Promise.resolve();
  });

  it('processa solicitações até não haver mais itens vencidos', async () => {
    processOneDueAccountDeletionRequestMock
      .mockResolvedValueOnce(completedRequest)
      .mockResolvedValueOnce(completedRequest)
      .mockResolvedValueOnce(noRequest);

    await runAccountDeletionWorkerCycle();

    expect(processOneDueAccountDeletionRequestMock).toHaveBeenCalledTimes(3);
  });

  it('respeita o limite de dez solicitações por ciclo', async () => {
    processOneDueAccountDeletionRequestMock.mockResolvedValue(completedRequest);

    await runAccountDeletionWorkerCycle();

    expect(processOneDueAccountDeletionRequestMock).toHaveBeenCalledTimes(10);
  });

  it('registra falha técnica e continua em ciclos futuros', async () => {
    vi.useFakeTimers();
    process.env.ACCOUNT_DELETION_WORKER_ENABLED = '1';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    processOneDueAccountDeletionRequestMock
      .mockRejectedValueOnce(new Error('sensitive backend error'))
      .mockResolvedValueOnce(noRequest);

    stopWorker = setupAccountDeletionWorker(60 * 1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(processOneDueAccountDeletionRequestMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith('Falha no ciclo de exclusão de contas.', {
      code: 'ACCOUNT_DELETION_WORKER_CYCLE_FAILED',
    });
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('sensitive backend error');
    warnSpy.mockRestore();
  });
});
