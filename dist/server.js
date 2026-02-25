"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const routes_1 = __importDefault(require("./routes"));
const public_routes_1 = __importDefault(require("./routes/public.routes"));
const migrations_1 = require("./database/migrations");
const migrationRunner_1 = require("./database/migrationRunner");
const errorHandler_1 = require("./middlewares/errorHandler");
const security_1 = require("./middlewares/security");
const requestSanitizer_1 = require("./middlewares/requestSanitizer");
const tempUploadCleanup_1 = require("./middlewares/tempUploadCleanup");
const logSanitizer_1 = require("./utils/logSanitizer");
const app = (0, express_1.default)();
exports.app = app;
const PORT = process.env.API_PORT || 3333;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 300;
const configuredRateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS);
const configuredRateLimitMaxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS);
const rateLimitWindowMs = Number.isFinite(configuredRateLimitWindowMs) && configuredRateLimitWindowMs > 0
    ? configuredRateLimitWindowMs
    : DEFAULT_RATE_LIMIT_WINDOW_MS;
const rateLimitMaxRequests = Number.isFinite(configuredRateLimitMaxRequests) && configuredRateLimitMaxRequests > 0
    ? configuredRateLimitMaxRequests
    : DEFAULT_RATE_LIMIT_MAX_REQUESTS;
const apiRateLimiter = (0, express_rate_limit_1.default)({
    windowMs: rateLimitWindowMs,
    limit: rateLimitMaxRequests,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.method === 'OPTIONS',
    message: { error: 'Muitas requisições. Tente novamente em instantes.' },
});
(0, logSanitizer_1.patchConsoleRedaction)();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((0, helmet_1.default)());
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Language', 'pt-BR');
    next();
});
app.use(security_1.securityHeaders);
app.use(security_1.enforceHttps);
app.use((0, cors_1.default)((0, security_1.buildCorsOptions)()));
app.use(apiRateLimiter);
app.use(express_1.default.json({
    limit: '2mb',
    type: 'application/json'
}));
app.use(express_1.default.urlencoded({
    extended: true,
    limit: '2mb',
    parameterLimit: 1000,
    type: 'application/x-www-form-urlencoded'
}));
app.use(requestSanitizer_1.requestSanitizer);
app.use(tempUploadCleanup_1.tempUploadCleanup);
app.use(routes_1.default);
app.use(public_routes_1.default);
app.get('/health', (req, res) => {
    res.json({
        message: 'Servidor funcionando',
        timestamp: new Date().toISOString(),
        charset: 'UTF-8'
    });
});
app.use(errorHandler_1.notFoundHandler);
app.use(errorHandler_1.globalErrorHandler);
async function startServer() {
    await (0, migrations_1.applyMigrations)();
    await (0, migrationRunner_1.runSqlMigrations)('up');
    const server = app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT} com suporte a UTF-8`);
    });
    setupProcessHandlers(server);
}
if (require.main === module) {
    void startServer().catch((error) => {
        console.error('Falha ao iniciar servidor:', (0, logSanitizer_1.redactValue)(error));
        process.exit(1);
    });
}
let isShuttingDown = false;
function setupProcessHandlers(server) {
    const gracefulShutdown = (reason, error) => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        if (error) {
            console.error(`Encerrando servidor por ${reason}:`, (0, logSanitizer_1.redactValue)(error));
        }
        else {
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
