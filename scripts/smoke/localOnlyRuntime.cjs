/*
 * Shared guard for local smoke and pentest processes.
 *
 * The application repository can contain production environment variables in
 * .env.  These helpers deliberately override every outbound integration used
 * by the backend before spawning an isolated test API.
 */
const LOCAL_ONLY_DATABASES = new Set([
  'imobiliaria_smoke_v2',
  'imobiliaria_contract_e2e',
  'imobiliaria_ui_smoke',
  'encontre_aqui_pentest',
  'encontreaqui_local',
]);

function assertLocalOnlyDatabase(database, label = 'processo local') {
  if (!LOCAL_ONLY_DATABASES.has(database)) {
    throw new Error(`${label} recusado fora da allowlist local. Recebido: ${database}`);
  }
}

function createLocalOnlyEnvironment({ database, port, r2Bucket, r2Prefix, pdfServiceUrl, pdfInternalApiKey }) {
  assertLocalOnlyDatabase(database, 'Runtime de smoke/pentest');

  // Local Docker can expose MySQL on a port other than TiDB's default 4000.
  // The host remains forced to loopback and the database remains allowlisted.
  const localDatabasePort = String(process.env.LOCAL_SMOKE_DB_PORT || process.env.DB_PORT || process.env.DATABASE_PORT || '4000');
  const localDatabaseUser = String(process.env.LOCAL_SMOKE_DB_USER || process.env.DB_USER || process.env.DATABASE_USER || 'root');
  const localDatabasePassword = String(process.env.LOCAL_SMOKE_DB_PASSWORD || process.env.DB_PASSWORD || process.env.DATABASE_PASSWORD || '');

  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (/^(SENTRY|FIREBASE|R2|CLOUDINARY|BREVO|RESEND|SMTP|SENDGRID|TWILIO|MAILGUN|POSTMARK|EMAIL_|GOOGLE|VERCEL|RAILWAY|DATABASE_URL|DB_URL|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)/i.test(name)) {
      environment[name] = '';
    }
  }

  return {
    ...environment,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_HOST: '127.0.0.1',
    DATABASE_HOST: '127.0.0.1',
    DB_PORT: localDatabasePort,
    DATABASE_PORT: localDatabasePort,
    DB_USER: localDatabaseUser,
    DATABASE_USER: localDatabaseUser,
    DB_PASSWORD: localDatabasePassword,
    DATABASE_PASSWORD: localDatabasePassword,
    DB_DATABASE: database,
    DATABASE_NAME: database,
    DB_SSL: 'false',
    DATABASE_SSL: 'false',
    REDIS_URL: '',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '6379',
    REDIS_PASSWORD: '',
    REDIS_USERNAME: '',
    JWT_SECRET: 'local-pentest-only-jwt-secret-not-for-production',
    CONTRACT_HANDSHAKE_PIN_SECRET: 'local-pentest-only-handshake-secret',
    SENTRY_ENABLED: 'false',
    SENTRY_DSN: '',
    FIREBASE_SERVICE_ACCOUNT_PATH: '',
    FIREBASE_PROJECT_ID: '',
    FIREBASE_PRIVATE_KEY: '',
    FIREBASE_CLIENT_EMAIL: '',
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
    EMAIL_PROVIDER: '',
    EMAIL_FROM: '',
    EMAIL_FROM_NAME: '',
    BREVO_API_KEY: '',
    RESEND_API_KEY: '',
    SMTP_HOST: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    SMTP_SERVICE: '',
    R2_ACCOUNT_ID: 'local-pentest',
    R2_ACCESS_KEY_ID: 'smoke-access',
    R2_SECRET_ACCESS_KEY: 'smoke-secret',
    R2_BUCKET: r2Bucket,
    R2_ENDPOINT: 'http://127.0.0.1:10001',
    R2_REGION: 'us-east-1',
    R2_PREFIX: r2Prefix,
    PDF_SERVICE_URL: pdfServiceUrl,
    PDF_INTERNAL_API_KEY: pdfInternalApiKey,
    PDF_SERVICE_TIMEOUT_MS: '5000',
    PDF_WORKER_ENABLED: 'false',
    DOCUMENT_DELETION_WORKER_ENABLED: 'false',
    DATA_RETENTION_WORKER_ENABLED: 'false',
    SRE_STATS_ENABLED: 'false',
    SECURITY_ALERT_WORKER_ENABLED: 'false',
    // Several synthetic accounts authenticate from the loopback address.
    RATE_LIMIT_MAX_REQUESTS: '5000',
    AUTH_RATE_LIMIT_MAX: '5000',
    AUTH_LIGHT_RATE_LIMIT_MAX: '5000',
    ADMIN_AUTH_RATE_LIMIT_MAX: '5000',
  };
}

module.exports = {
  LOCAL_ONLY_DATABASES,
  assertLocalOnlyDatabase,
  createLocalOnlyEnvironment,
};
