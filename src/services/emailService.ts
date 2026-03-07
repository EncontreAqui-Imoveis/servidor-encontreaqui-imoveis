import nodemailer from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

let cachedTransporter: nodemailer.Transporter | null = null;
let cachedProvider: 'brevo' | 'resend' | 'smtp' | null = null;

type EmailProvider = 'brevo' | 'resend' | 'smtp';
type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string | null;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveBrandName() {
  return String(process.env.EMAIL_BRAND_NAME ?? 'Sua Empresa').trim() || 'Sua Empresa';
}

function resolveLogoUrl() {
  return String(
    process.env.EMAIL_LOGO_URL_2X ??
    process.env.EMAIL_LOGO_URL ??
    ''
  ).trim();
}

function renderLogoMarkup(params?: { footer?: boolean }) {
  const brandName = escapeHtml(resolveBrandName());
  const logoUrl = resolveLogoUrl();
  const maxWidth = params?.footer ? 120 : 180;

  if (!logoUrl) {
    return (
      `<div style="` +
      `font-family:Arial,sans-serif;` +
      `font-size:${params?.footer ? 18 : 28}px;` +
      `line-height:${params?.footer ? 24 : 34}px;` +
      `font-weight:800;` +
      `color:${params?.footer ? '#0d5051' : '#FFFFFF'};` +
      `letter-spacing:-0.02em;` +
      `">` +
      `${brandName}` +
      `</div>`
    );
  }

  return (
    `<img ` +
    `src="${escapeHtml(logoUrl)}" ` +
    `alt="${brandName}" ` +
    `width="${maxWidth}" ` +
    `style="` +
    `display:block;` +
    `width:100%;` +
    `max-width:${maxWidth}px;` +
    `height:auto;` +
    `border:0;` +
    `outline:none;` +
    `text-decoration:none;` +
    `"` +
    `>`
  );
}

function buildEmailHtmlDocument(params: {
  preheader: string;
  title: string;
  subtitle: string;
  code: string;
  expiresAtText: string;
  helperText: string;
  supportText: string;
}) {
  const brandName = escapeHtml(resolveBrandName());
  const preheader = escapeHtml(params.preheader);
  const title = escapeHtml(params.title);
  const subtitle = escapeHtml(params.subtitle);
  const code = escapeHtml(params.code);
  const expiresAtText = escapeHtml(params.expiresAtText);
  const helperText = escapeHtml(params.helperText);
  const supportText = escapeHtml(params.supportText);
  const footerLogo = renderLogoMarkup({ footer: true });

  return (
    '<!DOCTYPE html>' +
    '<html lang="pt-BR">' +
    '<head>' +
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
    `<title>${title}</title>` +
    '</head>' +
    '<body style="margin:0;padding:0;background-color:#F4F4F5;">' +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${preheader}</div>` +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:#F4F4F5;mso-table-lspace:0pt;mso-table-rspace:0pt;">' +
    '<tr>' +
    '<td align="center" style="padding:36px 12px;background-color:#F4F4F5;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;border-collapse:separate;background-color:#FFFFFF;border:1px solid #D6D3D1;border-radius:24px;mso-table-lspace:0pt;mso-table-rspace:0pt;">' +
    '<tr>' +
    '<td align="center" style="padding:36px 32px 12px;">' +
    '<div style="display:inline-block;background-color:#E7E5E4;color:#44403C;font-family:Arial,sans-serif;font-size:12px;line-height:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding:10px 16px;border-radius:999px;">Código de segurança</div>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:0 32px 10px;font-family:Arial,sans-serif;font-size:34px;line-height:40px;font-weight:800;color:#1F2937;">' +
    title +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:0 32px 0;font-family:Arial,sans-serif;font-size:18px;line-height:28px;color:#334155;">' +
    subtitle +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:28px 32px 12px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' +
    '<tr>' +
    '<td align="center" style="background-color:#F8FAFC;border:1px dashed #94A3B8;border-radius:16px;padding:18px 28px;font-family:Arial,sans-serif;font-size:34px;line-height:38px;font-weight:800;letter-spacing:10px;color:#0F172A;">' +
    code +
    '</td>' +
    '</tr>' +
    '</table>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:4px 32px 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#475569;">' +
    `Esse código expira em <strong>${expiresAtText}</strong>.` +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:20px 32px 0;font-family:Arial,sans-serif;font-size:15px;line-height:24px;color:#334155;">' +
    helperText +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:16px 32px 36px;font-family:Arial,sans-serif;font-size:13px;line-height:21px;color:#64748B;">' +
    supportText +
    '</td>' +
    '</tr>' +
    '</table>' +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="padding:24px 16px 40px;background-color:#F4F4F5;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">' +
    '<tr>' +
    '<td align="center" style="padding:0 0 10px;">' +
    footerLogo +
    '</td>' +
    '</tr>' +
    '<tr>' +
    '<td align="center" style="font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748B;">' +
    `© ${new Date().getFullYear()} ${brandName}. Todos os direitos reservados.` +
    '</td>' +
    '</tr>' +
    '</table>' +
    '</td>' +
    '</tr>' +
    '</table>' +
    '</body>' +
    '</html>'
  );
}

function resolveEmailProvider(): EmailProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  const explicitProvider = String(process.env.EMAIL_PROVIDER ?? '')
    .trim()
    .toLowerCase();
  if (
    explicitProvider === 'brevo' ||
    explicitProvider === 'resend' ||
    explicitProvider === 'smtp'
  ) {
    cachedProvider = explicitProvider;
    return cachedProvider;
  }

  cachedProvider = process.env.BREVO_API_KEY?.trim()
    ? 'brevo'
    : process.env.RESEND_API_KEY?.trim()
      ? 'resend'
      : 'smtp';
  return cachedProvider;
}

function resolveFromAddress() {
  const from =
    process.env.EMAIL_FROM ??
    process.env.BREVO_FROM ??
    process.env.RESEND_FROM ??
    process.env.SMTP_FROM ??
    process.env.SMTP_USER ??
    '';

  if (!from.trim()) {
    throw new Error('EMAIL_FROM nao configurado.');
  }

  return from.trim();
}

function resolveFromName() {
  const fromName =
    process.env.EMAIL_FROM_NAME ??
    process.env.BREVO_FROM_NAME ??
    process.env.RESEND_FROM_NAME ??
    '';

  return fromName.trim() || null;
}

async function sendViaBrevo(message: EmailMessage) {
  const apiKey = String(process.env.BREVO_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('BREVO_API_KEY nao configurada.');
  }

  const apiBaseUrl = String(process.env.BREVO_API_BASE_URL ?? 'https://api.brevo.com').trim();
  const timeoutMs = Number(process.env.EMAIL_HTTP_TIMEOUT_MS ?? 10000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const senderEmail = resolveFromAddress();
    const senderName = resolveFromName();
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/v3/smtp/email`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: {
          email: senderEmail,
          ...(senderName ? { name: senderName } : {}),
        },
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
        ...(message.idempotencyKey
          ? {
              headers: {
                idempotencyKey: message.idempotencyKey,
              },
            }
          : {}),
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const providerMessage =
        String(
          parsedBody?.message ??
            parsedBody?.code ??
            parsedBody?.error ??
            rawBody ??
            `HTTP ${response.status}`
        ).trim() || `HTTP ${response.status}`;
      throw new Error(`Brevo send failed (${response.status}): ${providerMessage}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function sendViaResend(message: EmailMessage) {
  const apiKey = String(process.env.RESEND_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY nao configurada.');
  }

  const apiBaseUrl = String(process.env.RESEND_API_BASE_URL ?? 'https://api.resend.com').trim();
  const timeoutMs = Number(process.env.EMAIL_HTTP_TIMEOUT_MS ?? 10000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey
          ? {
              'Idempotency-Key': message.idempotencyKey,
            }
          : {}),
      },
      body: JSON.stringify({
        from: resolveFromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let parsedBody: Record<string, unknown> | null = null;
    try {
      parsedBody = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
      const providerMessage =
        String(
          parsedBody?.message ??
            parsedBody?.error ??
            rawBody ??
            `HTTP ${response.status}`
        ).trim() || `HTTP ${response.status}`;
      throw new Error(`Resend send failed (${response.status}): ${providerMessage}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

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
  const connectionTimeoutMs = Number(
    process.env.SMTP_CONNECTION_TIMEOUT_MS ?? timeoutMs
  );
  const greetingTimeoutMs = Number(
    process.env.SMTP_GREETING_TIMEOUT_MS ?? timeoutMs
  );
  const socketTimeoutMs = Number(
    process.env.SMTP_SOCKET_TIMEOUT_MS ?? timeoutMs
  );
  const dnsTimeoutMs = Number(
    process.env.SMTP_DNS_TIMEOUT_MS ?? timeoutMs
  );
  const family = Number(process.env.SMTP_FAMILY ?? 0) || undefined;
  const requireTLS =
    String(process.env.SMTP_REQUIRE_TLS ?? 'false').toLowerCase() === 'true';
  const ignoreTLS =
    String(process.env.SMTP_IGNORE_TLS ?? 'false').toLowerCase() === 'true';
  const tlsServername = String(process.env.SMTP_TLS_SERVERNAME ?? host ?? '').trim();
  const debug = String(process.env.SMTP_DEBUG ?? 'false').toLowerCase() === 'true';

  if ((!service && !host) || !user || !pass) {
    throw new Error(
      'SMTP nao configurado. Defina SMTP_HOST/SMTP_USER/SMTP_PASS ou SMTP_SERVICE.',
    );
  }

  let transportOptions: SMTPTransport.Options & {
    family?: number;
    dnsTimeout?: number;
  };
  if (service) {
    transportOptions = { service, auth: { user, pass } };
  } else {
    transportOptions = {
      host: host!,
      port,
      secure,
      auth: { user, pass },
      ...(family ? { family } : {}),
      ...(requireTLS ? { requireTLS: true } : {}),
      ...(ignoreTLS ? { ignoreTLS: true } : {}),
      ...(dnsTimeoutMs ? { dnsTimeout: dnsTimeoutMs } : {}),
      tls: {
        ...(tlsServername ? { servername: tlsServername } : {}),
      },
    };
  }

  cachedTransporter = nodemailer.createTransport({
    ...transportOptions,
    connectionTimeout: connectionTimeoutMs,
    greetingTimeout: greetingTimeoutMs,
    socketTimeout: socketTimeoutMs,
    logger: debug,
    debug,
  });

  return cachedTransporter;
}

async function sendViaSmtp(message: EmailMessage) {
  const transporter = getTransporter();
  await transporter.sendMail({
    from: resolveFromAddress(),
    to: message.to,
    subject: message.subject,
    text: message.text,
    ...(message.html ? { html: message.html } : {}),
  });
}

async function deliverEmail(message: EmailMessage) {
  const provider = resolveEmailProvider();
  if (provider === 'brevo') {
    await sendViaBrevo(message);
    return;
  }

  if (provider === 'resend') {
    await sendViaResend(message);
    return;
  }

  await sendViaSmtp(message);
}

export function resetEmailServiceForTests() {
  cachedTransporter = null;
  cachedProvider = null;
}

export async function sendPasswordResetEmail(params: {
  to: string;
  name?: string | null;
  code: string;
}) {

  const greeting = params.name ? `Ola, ${params.name}` : 'Ola';
  const subject = 'Recuperacao de senha';
  const text = `${greeting}.\n\n` +
    'Recebemos um pedido para redefinir sua senha.\n' +
    `Codigo de verificação: ${params.code}\n\n` +
    'Se não foi voce, ignore este email.\n';

  await deliverEmail({
    to: params.to,
    subject,
    text,
  });
}

export async function sendEmailCodeEmail(params: {
  to: string;
  name?: string | null;
  code: string;
  purpose: 'verify_email' | 'password_reset';
  expiresAt: Date;
  idempotencyKey?: string | null;
}) {
  const greeting = params.name ? `Olá, ${params.name}` : 'Olá';
  const expiresAtText = params.expiresAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
  });
  const purposeText =
    params.purpose === 'verify_email'
      ? 'para confirmar seu e-mail'
      : 'para redefinir sua senha';
  const subject =
    params.purpose === 'verify_email'
      ? 'Seu código de verificação do app EncontreAqui Imóveis'
      : 'Seu código para redefinir a senha do app EncontreAqui Imóveis';
  const title =
    params.purpose === 'verify_email'
      ? 'Confirme seu e-mail'
      : 'Redefina sua senha';
  const subtitle =
    params.purpose === 'verify_email'
      ? `${greeting}. Use o código abaixo para confirmar seu e-mail.`
      : `${greeting}. Use o código abaixo para redefinir sua senha com segurança.`;
  const preheader =
    params.purpose === 'verify_email'
      ? 'Código de 6 dígitos para confirmar seu e-mail.'
      : 'Código de 6 dígitos para redefinir sua senha.';
  const helperText =
    params.purpose === 'verify_email'
      ? 'Agora é só digitá-lo na tela de confirmação do nosso app para concluir a verificação.'
      : 'Agora é só digitá-lo na tela de recuperação do nosso app para criar uma nova senha.';
  const warningText =
    'Importante: nunca vamos pedir esse código por mensagem, telefone ou e-mail. Não compartilhe.';

  const text =
    `${greeting}.\n\n` +
    `Seu código ${params.purpose === 'verify_email' ? 'de verificação' : 'de recuperação'} ${purposeText}.\n\n` +
    `${params.code}\n\n` +
    `Esse código expira em ${expiresAtText}.\n\n` +
    `${helperText}\n\n` +
    `${warningText}\n\n` +
    'Se não foi você, ignore este e-mail.\n';

  const html = buildEmailHtmlDocument({
    preheader,
    title,
    subtitle,
    code: params.code,
    expiresAtText,
    helperText,
    supportText: `${warningText} Se não foi você, ignore este e-mail.`,
  });

  await deliverEmail({
    to: params.to,
    subject,
    text,
    html,
    idempotencyKey: params.idempotencyKey ?? null,
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
  idempotencyKey?: string | null;
}) {
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

  await deliverEmail({
    to: params.to,
    subject,
    text,
    html,
    idempotencyKey: params.idempotencyKey ?? null,
  });
}
