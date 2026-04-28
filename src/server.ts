import 'dotenv/config';
import { initSentry } from './config/sentry';

// Initialize Sentry before any other imports
initSentry();

import { createHttpApp } from './httpApp';
import { applyMigrations } from './database/migrations';
import { runSqlMigrations } from './database/migrationRunner';
import { setupProcessHandlers } from './serverLifecycle';
import { redactValue } from './utils/logSanitizer';
import { setupPdfWorker } from './modules/negotiations/infra/PdfWorker';

const app = createHttpApp();
const PORT = process.env.PORT || process.env.API_PORT || 3333;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  await applyMigrations();
  await runSqlMigrations('up');

  // Initialize background workers
  const pdfWorker = setupPdfWorker();
  if (pdfWorker) {
    console.log('Worker de PDF inicializado.');
  } else {
    console.log('Worker de PDF não inicializado (defina PDF_WORKER_ENABLED=true para habilitar).');
  }

  const server = app.listen(Number(PORT), HOST, () => {
    console.log(`Servidor rodando em ${HOST}:${PORT} com suporte a UTF-8`);
  });

  setupProcessHandlers(server);
}

export { app };

if (require.main === module) {
  void startServer().catch((error) => {
    console.error('Falha ao iniciar servidor:', redactValue(error));
    process.exit(1);
  });
}
