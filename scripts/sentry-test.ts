import * as Sentry from '@sentry/node';
import { initSentry } from '../src/config/sentry';

function isNonEmpty(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

(async () => {
  const dsn = String(process.env.SENTRY_DSN ?? '').trim();
  if (!dsn) {
    console.log('SENTRY_DSN não configurado. Pulando teste de envio.');
    return;
  }

  const environment = String(process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  if (environment === 'production' && !isNonEmpty(process.env.SENTRY_TEST_KEY)) {
    console.error('SENTRY_TEST_KEY não definido. Em produção, execute apenas com proteção explícita.');
    process.exit(1);
  }

  initSentry();

  const eventId = Sentry.captureMessage(
    '[backend] teste de integração de telemetria',
    'info',
  );

  console.log(`Evento Sentry enviado com sucesso. EventId: ${eventId}`);

  await Sentry.close(2000);
  console.log('Flush finalizado. Verifique o dashboard do Sentry (eventId acima).');
})();
