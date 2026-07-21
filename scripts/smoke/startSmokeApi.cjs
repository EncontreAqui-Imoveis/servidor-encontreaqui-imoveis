const { spawn } = require('node:child_process');
const path = require('node:path');
const dotenv = require('dotenv');

const backendRoot = path.resolve(__dirname, '..', '..');
const smokeDatabase = process.env.SMOKE_DATABASE || 'imobiliaria_smoke_v2';

dotenv.config({ path: path.join(backendRoot, '.env') });

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: '3334',
  DB_DATABASE: smokeDatabase,
  DATABASE_NAME: smokeDatabase,
  DB_SSL: 'false',
  DATABASE_SSL: 'false',
  R2_ACCOUNT_ID: 'smoke-local',
  R2_ACCESS_KEY_ID: 'smoke-access',
  R2_SECRET_ACCESS_KEY: 'smoke-secret',
  R2_BUCKET: 'imobiliaria-smoke',
  R2_ENDPOINT: 'http://127.0.0.1:10001',
  R2_REGION: 'us-east-1',
  R2_PREFIX: 'contract-smoke',
  PDF_WORKER_ENABLED: 'false',
});

const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: backendRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
