import type { Server } from 'http';
import { redactValue } from './utils/logSanitizer';

let isShuttingDown = false;

export function setupProcessHandlers(server: Server) {
  const gracefulShutdown = (reason: string, error?: unknown) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (error) {
      console.error(`Encerrando servidor por ${reason}:`, redactValue(error));
    } else {
      console.warn(`Encerrando servidor por ${reason}.`);
    }

    server.close(() => {
      process.exit(error ? 1 : 0);
    });

    setTimeout(() => {
      process.exit(error ? 1 : 0);
    }, 10000).unref();
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('uncaughtException', (error) => {
    gracefulShutdown('uncaughtException', error);
  });
  process.on('unhandledRejection', (reason) => {
    gracefulShutdown('unhandledRejection', reason);
  });
}
