import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

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
    throw new Error(
      'SMTP nao configurado. Defina SMTP_HOST/SMTP_USER/SMTP_PASS ou SMTP_SERVICE.',
    );
  }

  let transportOptions: SMTPTransport.Options;
  if (service) {
    transportOptions = { service, auth: { user, pass } };
  } else {
    transportOptions = { host: host!, port, secure, auth: { user, pass } };
  }

  cachedTransporter = nodemailer.createTransport({
    ...transportOptions,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    logger: debug,
    debug,
  });

  return cachedTransporter;
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name?: string | null;
  code: string;
}) {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '';
  if (!from) {
    throw new Error('SMTP_FROM nao configurado.');
  }

  const greeting = params.name ? `Ola, ${params.name}` : 'Ola';
  const subject = 'Recuperacao de senha';
  const text = `${greeting}.\n\n` +
    'Recebemos um pedido para redefinir sua senha.\n' +
    `Codigo de verificação: ${params.code}\n\n` +
    'Se não foi voce, ignore este email.\n';

  await transporter.sendMail({
    from,
    to: params.to,
    subject,
    text,
  });
}

export function buildEmailVerificationHandlerUrl(params: {
  handlerUrl: string;
  firebaseActionLink: string;
  email: string;
  continueUrl?: string | null;
}) {
  const firebaseUrl = new URL(params.firebaseActionLink);
  const mode = firebaseUrl.searchParams.get('mode') ?? 'verifyEmail';
  const oobCode = firebaseUrl.searchParams.get('oobCode');

  if (!oobCode) {
    throw new Error('Firebase action link missing oobCode.');
  }

  const handlerUrl = new URL(params.handlerUrl);
  handlerUrl.searchParams.set('mode', mode);
  handlerUrl.searchParams.set('oobCode', oobCode);
  handlerUrl.searchParams.set('email', params.email);

  if (params.continueUrl && params.continueUrl.trim().length > 0) {
    handlerUrl.searchParams.set('continueUrl', params.continueUrl.trim());
  }

  return handlerUrl.toString();
}

export async function sendEmailVerificationEmail(params: {
  to: string;
  name?: string | null;
  actionUrl: string;
  expiresAt: Date;
}) {
  const transporter = getTransporter();
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? '';
  if (!from) {
    throw new Error('SMTP_FROM nao configurado.');
  }

  const greeting = params.name ? `Ola, ${params.name}` : 'Ola';
  const subject = 'Verifique seu email do app EncontreAqui Imoveis';
  const expiresAtText = params.expiresAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });

  const text =
    `${greeting}.\n\n` +
    'Clique no link abaixo para confirmar seu email.\n\n' +
    `${params.actionUrl}\n\n` +
    `Esse link expira em ${expiresAtText}.\n\n` +
    'Se nao foi voce, ignore este email.\n';

  const html =
    `<p>${greeting}.</p>` +
    '<p>Clique no botao abaixo para confirmar seu email.</p>' +
    `<p><a href="${params.actionUrl}" style="display:inline-block;padding:12px 20px;background:#0D5D50;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Clique aqui para confirmar seu e-mail</a></p>` +
    `<p>Esse link expira em <strong>${expiresAtText}</strong>.</p>` +
    '<p>Se nao foi voce, ignore este email.</p>';

  await transporter.sendMail({
    from,
    to: params.to,
    subject,
    text,
    html,
  });
}
