import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mainRoutes from './routes';
import publicRoutes from './routes/public.routes';
import { globalErrorHandler, notFoundHandler } from './middlewares/errorHandler';
import { getRequestId, requestContextMiddleware } from './middlewares/requestContext';
import {
  buildCorsOptions,
  enforceHttps,
  securityHeaders,
} from './middlewares/security';
import { requestSanitizer } from './middlewares/requestSanitizer';
import { tempUploadCleanup } from './middlewares/tempUploadCleanup';
import { patchConsoleRedaction } from './utils/logSanitizer';
import { metricsMiddleware, getMetrics } from './middlewares/metrics';

const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;

function resolveRateLimitWindowMs() {
  const configuredValue = Number(process.env.RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(configuredValue) && configuredValue > 0
    ? configuredValue
    : DEFAULT_RATE_LIMIT_WINDOW_MS;
}

function resolveRateLimitMaxRequests() {
  const configuredValue = Number(process.env.RATE_LIMIT_MAX_REQUESTS);
  return Number.isFinite(configuredValue) && configuredValue > 0
    ? configuredValue
    : DEFAULT_RATE_LIMIT_MAX_REQUESTS;
}

function createApiRateLimiter() {
  return rateLimit({
    windowMs: resolveRateLimitWindowMs(),
    limit: resolveRateLimitMaxRequests(),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.method === 'OPTIONS',
    handler: (req, res) => {
      return res.status(429).json({
        error: 'Muitas requisições. Tente novamente em instantes.',
        requestId: getRequestId(req),
      });
    },
  });
}

export function createHttpApp() {
  const app = express();
  const corsOptions = buildCorsOptions();

  patchConsoleRedaction();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Initializing metrics collection
  app.use(metricsMiddleware);

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
    }),
  );

  app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Language', 'pt-BR');
    next();
  });

  app.use(requestContextMiddleware);
  app.use(securityHeaders);
  app.use(enforceHttps);
  app.use(cors(corsOptions));
  app.options('/{*corsPreflight}', cors(corsOptions));
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });
  app.use(createApiRateLimiter());

  app.use(
    express.json({
      limit: '2mb',
      type: 'application/json',
    }),
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: '2mb',
      parameterLimit: 1000,
      type: 'application/x-www-form-urlencoded',
    }),
  );
  app.use(requestSanitizer);
  app.use(tempUploadCleanup);

  app.use(mainRoutes);
  app.use(publicRoutes);

  app.get('/health', (req, res) => {
    res.json({
      message: 'Servidor funcionando',
      timestamp: new Date().toISOString(),
      charset: 'UTF-8',
    });
  });

  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.end(await getMetrics());
    } catch (err) {
      res.status(500).end(err);
    }
  });

  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
