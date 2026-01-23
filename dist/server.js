"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = __importDefault(require("./routes"));
const public_routes_1 = __importDefault(require("./routes/public.routes"));
const migrations_1 = require("./database/migrations");
const app = (0, express_1.default)();
const PORT = process.env.API_PORT || 3333;
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Language', 'pt-BR');
    next();
});
app.use((0, cors_1.default)());
app.use(express_1.default.json({
    limit: '10mb',
    type: 'application/json'
}));
app.use(express_1.default.urlencoded({
    extended: true,
    limit: '10mb',
    parameterLimit: 10000,
    type: 'application/x-www-form-urlencoded'
}));
app.use(routes_1.default);
app.use(public_routes_1.default);
app.get('/health', (req, res) => {
    res.json({
        message: 'Servidor funcionando',
        timestamp: new Date().toISOString(),
        charset: 'UTF-8'
    });
});
app.use((err, req, res, next) => {
    if (err.type === 'request.aborted' || err.code === 'ECONNRESET') {
        return res.status(400).json({ error: 'Request aborted' });
    }
    console.error('Unhandled error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
});
async function startServer() {
    await (0, migrations_1.applyMigrations)();
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT} com suporte a UTF-8`);
    });
}
void startServer();
