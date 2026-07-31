import { createHmac } from 'crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureWebhookRawBody,
  requireOperationalSecret,
} from '../../src/middlewares/operationalAccess';

const { updateReleaseMock } = vi.hoisted(() => ({ updateReleaseMock: vi.fn() }));

vi.mock('../../src/services/sreStatsService', () => ({
  loadSreStats: vi.fn(),
  updateExternalService: vi.fn(),
  updateRelease: updateReleaseMock,
}));

function sign(algorithm: 'sha1' | 'sha256', secret: string, body: string): string {
  return createHmac(algorithm, secret).update(body).digest('hex');
}

describe('operational endpoint access', () => {
  const originalEnv = {
    github: process.env.GITHUB_WEBHOOK_SECRET,
    vercel: process.env.VERCEL_WEBHOOK_SECRET,
    railway: process.env.RAILWAY_WEBHOOK_SECRET,
    metrics: process.env.METRICS_SECRET_KEY,
  };
  let app: express.Express;

  beforeAll(async () => {
    const { default: dashboardRoutes } = await import('../../src/routes/dashboard.routes');
    app = express();
    app.use(express.json({ verify: captureWebhookRawBody }));
    app.use('/admin/dashboard', dashboardRoutes);
    app.get('/metrics-test', requireOperationalSecret('METRICS_SECRET_KEY', 'x-metrics-secret'), (_req, res) => {
      res.type('text/plain').send('metrics');
    });
  });

  beforeEach(() => vi.clearAllMocks());

  afterEach(() => {
    const restore = (key: keyof typeof originalEnv, name: string) => {
      const value = originalEnv[key];
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    };
    restore('github', 'GITHUB_WEBHOOK_SECRET');
    restore('vercel', 'VERCEL_WEBHOOK_SECRET');
    restore('railway', 'RAILWAY_WEBHOOK_SECRET');
    restore('metrics', 'METRICS_SECRET_KEY');
  });

  it('keeps metrics unavailable until an operational secret is configured', async () => {
    delete process.env.METRICS_SECRET_KEY;
    await request(app).get('/metrics-test').expect(404);

    process.env.METRICS_SECRET_KEY = 'metrics-secret';
    await request(app).get('/metrics-test').set('x-metrics-secret', 'wrong').expect(401);
    await request(app).get('/metrics-test').set('x-metrics-secret', 'metrics-secret').expect(200, 'metrics');
  });

  it('rejects unsigned GitHub deliveries and accepts only a valid SHA-256 HMAC', async () => {
    const body = JSON.stringify({ head_commit: { id: 'abcdef123', message: 'deploy' } });
    delete process.env.GITHUB_WEBHOOK_SECRET;
    await request(app).post('/admin/dashboard/webhook/github').type('json').send(body).expect(503);

    process.env.GITHUB_WEBHOOK_SECRET = 'github-secret';
    await request(app).post('/admin/dashboard/webhook/github').type('json').send(body).expect(401);
    expect(updateReleaseMock).not.toHaveBeenCalled();

    await request(app)
      .post('/admin/dashboard/webhook/github')
      .type('json')
      .set('x-hub-signature-256', `sha256=${sign('sha256', 'github-secret', body)}`)
      .send(body)
      .expect(200, { status: 'processed' });
    expect(updateReleaseMock).toHaveBeenCalledOnce();
  });

  it('accepts Vercel only with a valid SHA-1 HMAC over the raw payload', async () => {
    const body = JSON.stringify({ type: 'deployment.succeeded', payload: { name: 'site', deployment: { id: 'abcdef123' } } });
    process.env.VERCEL_WEBHOOK_SECRET = 'vercel-secret';

    await request(app)
      .post('/admin/dashboard/webhook/vercel')
      .type('json')
      .set('x-vercel-signature', sign('sha1', 'vercel-secret', body))
      .send(body)
      .expect(200, { status: 'processed' });
    expect(updateReleaseMock).toHaveBeenCalledWith('vercel', 'site', expect.any(Object));
  });

  it('requires the Railway capability token before processing a deployment event', async () => {
    process.env.RAILWAY_WEBHOOK_SECRET = 'railway-secret';
    const payload = { type: 'DEPLOYMENT_DEPLOYED', status: 'SUCCESS' };

    await request(app).post('/admin/dashboard/webhook/railway').send(payload).expect(401);
    expect(updateReleaseMock).not.toHaveBeenCalled();

    await request(app)
      .post('/admin/dashboard/webhook/railway?token=railway-secret')
      .send(payload)
      .expect(200, { status: 'processed' });
    expect(updateReleaseMock).toHaveBeenCalledOnce();
  });
});
