import 'dotenv/config';
import express from 'express';
import type { Server } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mainRoutes from './routes';
import publicRoutes from './routes/public.routes';
import { applyMigrations } from './database/migrations';
import { runSqlMigrations } from './database/migrationRunner';
import { globalErrorHandler, notFoundHandler } from './middlewares/errorHandler';
import {
  buildCorsOptions,
  enforceHttps,
  securityHeaders,
} from './middlewares/security';
import { requestSanitizer } from './middlewares/requestSanitizer';
import { tempUploadCleanup } from './middlewares/tempUploadCleanup';
import { patchConsoleRedaction, redactValue } from './utils/logSanitizer';

const app = express();
const PORT = process.env.API_PORT || 3333;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;
const configuredRateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
const configuredRateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS);
const rateLimitWindowMs =
  Number.isFinite(configuredRateLimitWindowMs) && configuredRateLimitWindowMs > 0
    ? configuredRateLimitWindowMs
    : DEFAULT_RATE_LIMIT_WINDOW_MS;
const rateLimitMaxRequests =
  Number.isFinite(configuredRateLimitMaxRequests) && configuredRateLimitMaxRequests > 0
    ? configuredRateLimitMaxRequests
    : DEFAULT_RATE_LIMIT_MAX_REQUESTS;

const apiRateLimiter = rateLimit({
  windowMs: rateLimitWindowMs,
  limit: rateLimitMaxRequests,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.method === 'OPTIONS',
  message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});

patchConsoleRedaction();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);

app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Language', 'pt-BR');
  next();
});

app.use(securityHeaders);
app.use(enforceHttps);
app.use(cors(buildCorsOptions()));
app.use(apiRateLimiter);

app.use(express.json({
  limit: '2mb',
  type: 'application/json'
}));

app.use(express.urlencoded({
  extended: true,
  limit: '2mb',
  parameterLimit: 1000,
  type: 'application/x-www-form-urlencoded'
}));
app.use(requestSanitizer);
app.use(tempUploadCleanup);

app.use(mainRoutes);
app.use(publicRoutes);

app.get('/health', (req, res) => {
  res.json({
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString(),
    charset: 'UTF-8'
  });
});

app.use(notFoundHandler);
app.use(globalErrorHandler);

async function startServer() {
  await applyMigrations();
  await runSqlMigrations('up');

  const server = app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} com suporte a UTF-8`);
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

let isShuttingDown = false;

function setupProcessHandlers(server: Server) {
  const gracefulShutdown = (reason: string, error?: unknown) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    if (error) {
      console.error(
        `Encerrando servidor por ${reason}:`,
        redactValue(error)
      );
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
