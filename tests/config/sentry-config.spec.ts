import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  consoleLoggingIntegration: vi.fn(() => 'console-logs'),
}));
vi.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: vi.fn(() => 'profiling'),
}));

import { initSentry } from '../../src/config/sentry';
const { init } = Sentry;
const { consoleLoggingIntegration } = Sentry;

describe('initSentry', () => {
  const originalDsn = process.env.SENTRY_DSN;

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
    delete process.env.NODE_ENV;
  });

  it('não inicializa quando DSN está ausente', () => {
    delete process.env.SENTRY_DSN;

    initSentry();

    expect((init as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('inicializa com DSN normalizado e ambiente', () => {
    process.env.SENTRY_DSN = ' https://example@sentry.io/1 ';
    process.env.NODE_ENV = 'production';
    delete process.env.DB_DIALECT;

    initSentry();

    expect(init).toHaveBeenCalledTimes(1);
    expect(consoleLoggingIntegration).toHaveBeenCalledWith({
      levels: ['log', 'warn', 'error'],
    });
    expect(init).toHaveBeenCalledWith({
      dsn: 'https://example@sentry.io/1',
      enableLogs: true,
      integrations: ['profiling', 'console-logs'],
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
      environment: 'production',
    });
  });
});
