import * as Sentry from '@sentry/node';
import { redactString } from '../utils/logSanitizer';

function isEnabledFlag(value: unknown): boolean {
  return ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function resolveSampleRate(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 0.01;
  }
  return parsed;
}

export function isSentryEnabled(): boolean {
  return isEnabledFlag(process.env.SENTRY_ENABLED)
    && String(process.env.SENTRY_DSN ?? '').trim().length > 0;
}

export function initSentry() {
  const rawDsn = process.env.SENTRY_DSN;
  const dsn = String(rawDsn ?? '').trim();
  
  if (!isSentryEnabled()) {
    console.info('Sentry desabilitado. Exige SENTRY_ENABLED=true e SENTRY_DSN configurado.');
    return;
  }

  try {
    Sentry.init({
      dsn,
      enableLogs: false,
      sendDefaultPii: false,
      tracesSampleRate: resolveSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
      profilesSampleRate: 0,
      environment: process.env.NODE_ENV || 'development',
      beforeSend(event) {
        // Error reporting must never include request, user, breadcrumb or raw error data.
        event.request = undefined;
        event.user = undefined;
        event.breadcrumbs = [];
        event.extra = undefined;
        for (const value of event.exception?.values ?? []) {
          value.value = value.value ? redactString(value.value) : value.value;
        }
        return event;
      },
    });

    console.log('Sentry inicializado com telemetria minimizada.');
  } catch (error) {
    console.error('Falha ao inicializar Sentry. Seguindo sem telemetria:', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
