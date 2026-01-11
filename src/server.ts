import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mainRoutes from './routes';
import publicRoutes from './routes/public.routes';
import { applyMigrations } from './database/migrations';

const app = express();
const PORT = process.env.API_PORT || 3333;

app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Language', 'pt-BR');
  next();
});

app.use(cors());

app.use(express.json({
  limit: '10mb',
  type: 'application/json'
}));

app.use(express.urlencoded({
  extended: true,
  limit: '10mb',
  parameterLimit: 10000,
  type: 'application/x-www-form-urlencoded'
}));

app.use(mainRoutes);
app.use(publicRoutes);

app.get('/health', (req, res) => {
  res.json({
    message: 'Servidor funcionando',
    timestamp: new Date().toISOString(),
    charset: 'UTF-8'
  });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'request.aborted' || err.code === 'ECONNRESET') {
    return res.status(400).json({ error: 'Request aborted' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal Server Error' });
});

async function startServer() {
  await applyMigrations();

  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT} com suporte a UTF-8`);
  });
}

void startServer();
