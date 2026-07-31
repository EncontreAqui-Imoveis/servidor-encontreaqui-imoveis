import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
}));

import { initSentry, isSentryEnabled } from '../../src/config/sentry';
const { init } = Sentry;

describe('initSentry', () => {
  const originalDsn = process.env.SENTRY_DSN;
  const originalEnabled = process.env.SENTRY_ENABLED;
  const originalSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE;

  beforeEach(() => {
    vi.clearAllMocks();
    if (originalDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalDsn;
    }
    if (originalEnabled === undefined) {
      delete process.env.SENTRY_ENABLED;
    } else {
      process.env.SENTRY_ENABLED = originalEnabled;
    }
    if (originalSampleRate === undefined) {
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    } else {
      process.env.SENTRY_TRACES_SAMPLE_RATE = originalSampleRate;
    }
    delete process.env.NODE_ENV;
  });

  it('não inicializa sem habilitação explícita, mesmo que exista DSN', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    process.env.SENTRY_ENABLED = 'false';

    initSentry();

    expect((init as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(isSentryEnabled()).toBe(false);
  });

  it('inicializa com coleta minimizada somente quando habilitado', () => {
    process.env.SENTRY_DSN = ' https://example@sentry.io/1 ';
    process.env.SENTRY_ENABLED = 'true';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.02';
    process.env.NODE_ENV = 'production';

    initSentry();

    expect(init).toHaveBeenCalledTimes(1);
    expect(isSentryEnabled()).toBe(true);
    const config = (init as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(config).toMatchObject({
      dsn: 'https://example@sentry.io/1',
      enableLogs: false,
      sendDefaultPii: false,
      tracesSampleRate: 0.02,
      profilesSampleRate: 0,
      environment: 'production',
    });
    expect(config.beforeSend({
      request: { headers: { authorization: 'Bearer secret' } },
      user: { email: 'titular@example.com' },
      breadcrumbs: [{ message: 'email titular@example.com' }],
      extra: { cpf: '000.000.000-00' },
      exception: { values: [{ value: 'Falha de titular@example.com' }] },
    }).exception.values[0].value).toBe('Falha de ***@***');
  });
});
