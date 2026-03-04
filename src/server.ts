import 'dotenv/config';
import { createHttpApp } from './httpApp';
import { applyMigrations } from './database/migrations';
import { runSqlMigrations } from './database/migrationRunner';
import { setupProcessHandlers } from './serverLifecycle';
import { redactValue } from './utils/logSanitizer';

const app = createHttpApp();
const PORT = process.env.PORT || process.env.API_PORT || 3333;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  await applyMigrations();
  await runSqlMigrations('up');

  const server = app.listen(Number(PORT), HOST, () => {
    console.log(`Servidor rodando em ${HOST}:${PORT} com suporte a UTF-8`);
  });

  setupProcessHandlers(server);
}

export { app };

if (require.main === module) {
  void startServer().catch((error) => {
    console.error('Falha ao iniciar servidor:', redactValue(error));
    process.exit(1);
  });
}
