import nodemailer from 'nodemailer';

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE ?? 'false').toLowerCase() === 'true';

  if (!host || !user || !pass) {
    throw new Error('SMTP nao configurado. Defina SMTP_HOST/SMTP_USER/SMTP_PASS.');
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
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
    `Codigo de verificacao: ${params.code}\n\n` +
    'Se nao foi voce, ignore este email.\n';

  await transporter.sendMail({
    from,
    to: params.to,
    subject,
    text,
  });
}
