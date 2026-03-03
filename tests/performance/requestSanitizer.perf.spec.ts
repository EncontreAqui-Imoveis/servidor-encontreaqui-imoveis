import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { requestSanitizer } from '../../src/middlewares/requestSanitizer';

function buildPayload(itemCount: number) {
  return {
    cep: '75.935-000',
    owner_phone: '(64) 99231-6174',
    price: 'R$ 350.000,90',
    items: Array.from({ length: itemCount }, (_, index) => ({
      title: `Imóvel \u0001${index + 1}\u0007`,
      description: `Descrição \u0000${index + 1}`,
      nested: {
        note: `Observação \u0002${index + 1}`,
      },
    })),
  };
}

describe('requestSanitizer performance', () => {
  it('sanitizes a representative payload inside the latency budget', async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use(requestSanitizer);
    app.post('/sanitize', (req, res) => {
      const first = Array.isArray(req.body?.items) ? req.body.items[0] : null;
      res.json({
        cep: req.body?.cep,
        owner_phone: req.body?.owner_phone,
        price: req.body?.price,
        firstTitle: first?.title,
        firstDescription: first?.description,
        totalItems: Array.isArray(req.body?.items) ? req.body.items.length : 0,
      });
    });

    const payload = buildPayload(1000);
    const startedAt = Date.now();
    const response = await request(app).post('/sanitize').send(payload);
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    expect(response.body.totalItems).toBe(1000);
    expect(response.body.cep).toBe('75935000');
    expect(response.body.owner_phone).toBe('64992316174');
    expect(response.body.price).toBe('350.000');
    expect(response.body.firstTitle).toBe('Imóvel 1');
    expect(response.body.firstDescription).toBe('Descrição 1');
    expect(elapsedMs).toBeLessThan(1500);
  });
});
