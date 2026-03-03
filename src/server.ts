import 'dotenv/config';
import { createHttpApp } from './httpApp';
import { applyMigrations } from './database/migrations';
import { runSqlMigrations } from './database/migrationRunner';
import { setupProcessHandlers } from './serverLifecycle';
import { redactValue } from './utils/logSanitizer';

const app = createHttpApp();
const PORT = process.env.PORT || process.env.API_PORT || 3333;

async function startServer() {
  await applyMigrations();
  await runSqlMigrations('up');

  const server = app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} com suporte a UTF-8`);
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
