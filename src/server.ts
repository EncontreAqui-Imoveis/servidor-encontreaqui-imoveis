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
import { setupNegotiationDocumentDeletionWorker } from './services/negotiationDocumentDeletionService';
import { discardExpiredDrafts } from './services/registrationDraftRepository';
import { discardExpiredPhoneOtps } from './services/phoneOtpService';
import { ensureBrazilianCityCatalogSeeded } from './services/locationCatalogSeedService';

const app = createHttpApp();
const PORT = process.env.PORT || process.env.API_PORT || 3333;
const HOST = process.env.HOST || '0.0.0.0';
const DRAFT_CLEANUP_INTERVAL_MS = 60 * 1000;
const PHONE_OTP_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function setupRegistrationDraftCleanupWorker() {
  let running = false;

  const runCleanup = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const removed = await discardExpiredDrafts();
      if (removed > 0) {
        console.log(`Limpeza de rascunhos expirados concluida: ${removed}`);
      }
    } catch (error) {
      console.error('Falha ao limpar rascunhos expirados:', redactValue(error));
    } finally {
      running = false;
    }
  };

  void runCleanup();
  return setInterval(() => {
    void runCleanup();
  }, DRAFT_CLEANUP_INTERVAL_MS);
}

function setupPhoneOtpCleanupWorker() {
  let running = false;

  const runCleanup = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await discardExpiredPhoneOtps();
    } catch (error) {
      console.error('Falha ao limpar OTPs de telefone expirados:', redactValue(error));
    } finally {
      running = false;
    }
  };

  void runCleanup();
  return setInterval(() => {
    void runCleanup();
  }, PHONE_OTP_CLEANUP_INTERVAL_MS);
}

async function startServer() {
  await applyMigrations();
  await runSqlMigrations('up');
  const seededCities = await ensureBrazilianCityCatalogSeeded();
  if (seededCities > 0) {
    console.log(`Catalogo nacional de municipios sincronizado: ${seededCities}`);
  }

  // Initialize background workers
  const pdfWorker = setupPdfWorker();
  if (pdfWorker) {
    console.log('Worker de PDF inicializado.');
  } else {
    console.log('Worker de PDF não inicializado (defina PDF_WORKER_ENABLED=true para habilitar).');
  }

  const documentDeletionWorker = setupNegotiationDocumentDeletionWorker();
  if (documentDeletionWorker) {
    console.log('Worker de deleção de documentos inicializado.');
  } else {
    console.log('Worker de deleção de documentos não inicializado.');
  }

  const draftCleanupTimer = setupRegistrationDraftCleanupWorker();
  const phoneOtpCleanupTimer = setupPhoneOtpCleanupWorker();

  const server = app.listen(Number(PORT), HOST, () => {
    console.log(`Servidor rodando em ${HOST}:${PORT} com suporte a UTF-8`);
  });

  setupProcessHandlers(server);
  server.on('close', () => {
    clearInterval(draftCleanupTimer);
    clearInterval(phoneOtpCleanupTimer);
  });
}

export { app };

if (require.main === module) {
  void startServer().catch((error) => {
    console.error('Falha ao iniciar servidor:', redactValue(error));
    process.exit(1);
  });
}
