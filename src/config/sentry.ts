import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { consoleLoggingIntegration } from '@sentry/node';

export function initSentry() {
  const rawDsn = process.env.SENTRY_DSN;
  const dsn = String(rawDsn ?? '').trim();
  
  if (!dsn) {
    console.warn('SENTRY_DSN não encontrado no .env. Sentry desabilitado.');
    return;
  }

  try {
    Sentry.init({
      dsn,
      enableLogs: true,
      integrations: [
        nodeProfilingIntegration(),
        consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
      ],
      // Performance Monitoring
      tracesSampleRate: 1.0, // Capture 100% of the transactions
      // Set sampling rate for profiling - this is relative to tracesSampleRate
      profilesSampleRate: 1.0,
      environment: process.env.NODE_ENV || 'development',
    });

    console.log(`Sentry inicializado com sucesso (DSN: ${dsn.substring(0, 10)}...)`);
  } catch (error) {
    console.error('Falha ao inicializar Sentry. Seguindo sem telemetria:', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
