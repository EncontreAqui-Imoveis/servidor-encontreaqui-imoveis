const { spawn } = require('node:child_process');
const path = require('node:path');
const dotenv = require('dotenv');
const { assertLocalOnlyDatabase, createLocalOnlyEnvironment } = require('./localOnlyRuntime.cjs');

const backendRoot = path.resolve(__dirname, '..', '..');
const smokeDatabase = process.env.SMOKE_DATABASE || 'imobiliaria_smoke_v2';
assertLocalOnlyDatabase(smokeDatabase, 'API de smoke de contratos');

// The smoke API must never inherit remote credentials from the default .env.
// Its runtime guard then replaces every outbound integration with local-only values.
dotenv.config({ path: path.join(backendRoot, '.env.local'), override: true });

const smokeEnvironment = createLocalOnlyEnvironment({
  database: smokeDatabase,
  port: process.env.SMOKE_API_PORT || '3334',
  r2Bucket: smokeDatabase === 'encontre_aqui_pentest' ? 'imobiliaria-pentest' : 'imobiliaria-smoke',
  r2Prefix: 'contract-smoke',
  pdfServiceUrl: 'http://127.0.0.1:3336',
  pdfInternalApiKey: 'deal-e2e-local-key',
});

const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: backendRoot,
  env: smokeEnvironment,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
