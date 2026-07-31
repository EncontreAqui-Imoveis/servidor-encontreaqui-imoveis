import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  createAuthRegistrationLimiter,
  createOtpVerificationLimiter,
  createPreAuthUploadLimiter,
} from '../../src/config/rateLimiters';

function testApp(middleware: express.RequestHandler, path: string) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post(path, middleware, (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('rate limits pré-autenticação', () => {
  it('limita tentativa repetida de cadastro pelo mesmo e-mail mesmo ao trocar de IP', async () => {
    const app = testApp(createAuthRegistrationLimiter(), '/register');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request(app)
        .post('/register')
        .set('x-forwarded-for', `203.0.113.${attempt + 1}`)
        .send({ email: 'mesma-conta@example.test' });
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/register')
      .set('x-forwarded-for', '198.51.100.2')
      .send({ email: 'mesma-conta@example.test' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('cadastro');
  });

  it('limita adivinhações de OTP por sessão, não apenas por IP', async () => {
    const app = testApp(createOtpVerificationLimiter(), '/verify');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app)
        .post('/verify')
        .set('x-forwarded-for', `203.0.113.${attempt + 10}`)
        .send({ sessionToken: 'opaque-otp-session' });
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/verify')
      .set('x-forwarded-for', '198.51.100.10')
      .send({ sessionToken: 'opaque-otp-session' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('verificacao');
  });

  it('limita uploads pré-autenticação por rascunho mesmo quando o IP muda', async () => {
    const app = testApp(createPreAuthUploadLimiter(), '/draft/:draftId/upload');

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app)
        .post('/draft/draft-capability/upload')
        .set('x-forwarded-for', `203.0.113.${attempt + 30}`);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/draft/draft-capability/upload')
      .set('x-forwarded-for', '198.51.100.30');

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toContain('documento');
  });
});
