"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPasswordResetEmail = sendPasswordResetEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
let cachedTransporter = null;
function getTransporter() {
    if (cachedTransporter)
        return cachedTransporter;
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT ?? 587);
    const service = process.env.SMTP_SERVICE;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const secureEnv = process.env.SMTP_SECURE;
    const secure = secureEnv != null
        ? String(secureEnv).toLowerCase() === 'true'
        : port === 465;
    const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS ?? 10000);
    const debug = String(process.env.SMTP_DEBUG ?? 'false').toLowerCase() === 'true';
    if ((!service && !host) || !user || !pass) {
        throw new Error('SMTP nao configurado. Defina SMTP_HOST/SMTP_USER/SMTP_PASS ou SMTP_SERVICE.');
    }
    let transportOptions;
    if (service) {
        transportOptions = { service, auth: { user, pass } };
    }
    else {
        transportOptions = { host: host, port, secure, auth: { user, pass } };
    }
    cachedTransporter = nodemailer_1.default.createTransport({
        ...transportOptions,
        connectionTimeout: timeoutMs,
        greetingTimeout: timeoutMs,
        socketTimeout: timeoutMs,
        logger: debug,
        debug,
    });
    return cachedTransporter;
}
async function sendPasswordResetEmail(params) {
    const transporter = getTransporter();
    const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '';
    if (!from) {
        throw new Error('SMTP_FROM nao configurado.');
    }
    const greeting = params.name ? `Ola, ${params.name}` : 'Ola';
    const subject = 'Recuperacao de senha';
    const text = `${greeting}.\n\n` +
        'Recebemos um pedido para redefinir sua senha.\n' +
        `Codigo de verificacao: ${params.code}\n\n` +
        'Se nao foi voce, ignore este email.\n';
    await transporter.sendMail({
        from,
        to: params.to,
        subject,
        text,
    });
}
