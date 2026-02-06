import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mainRoutes from './routes';
import publicRoutes from './routes/public.routes';
import { applyMigrations } from './database/migrations';
import {
  buildCorsOptions,
  enforceHttps,
  securityHeaders,
} from './middlewares/security';
import { requestSanitizer } from './middlewares/requestSanitizer';
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
app.use(helmet());

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
  limit: '10mb',
  type: 'application/json'
}));

app.use(express.urlencoded({
  extended: true,
  limit: '10mb',
  parameterLimit: 10000,
  type: 'application/x-www-form-urlencoded'
}));
app.use(requestSanitizer);

app.use(mainRoutes);
app.use(publicRoutes);

app.get('/health', (req, res) => {
  res.json({
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString(),
    charset: 'UTF-8'
  });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'request.aborted' || err.code === 'ECONNRESET') {
    return res.status(400).json({ error: 'Request aborted' });
  }
  console.error('Unhandled error:', redactValue(err));
  return res.status(500).json({ error: 'Internal Server Error' });
});

async function startServer() {
  await applyMigrations();

  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} com suporte a UTF-8`);
  });
}

void startServer();
