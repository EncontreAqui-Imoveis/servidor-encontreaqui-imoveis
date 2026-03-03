import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { globalErrorHandler, notFoundHandler } from '../../src/middlewares/errorHandler';
import { getRequestId, requestContextMiddleware } from '../../src/middlewares/requestContext';

describe('requestContextMiddleware', () => {
  it('adds a request id header and exposes the same id to handlers', async () => {
    const app = express();
    app.use(requestContextMiddleware);
    app.get('/ok', (req, res) => {
      res.json({ requestId: getRequestId(req) });
    });

    const response = await request(app).get('/ok');

    expect(response.status).toBe(200);
    expect(typeof response.headers['x-request-id']).toBe('string');
    expect(response.headers['x-request-id']).toBe(response.body.requestId);
  });

  it('preserves an incoming x-request-id and propagates it to error responses', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const app = express();
    app.use(requestContextMiddleware);
    app.get('/boom', (_req, _res, next) => {
      next(Object.assign(new Error('falha de teste'), { statusCode: 400 }));
    });
    app.use(notFoundHandler);
    app.use(globalErrorHandler);

    const response = await request(app)
      .get('/boom')
      .set('X-Request-Id', 'req-test-123');

    expect(response.status).toBe(400);
    expect(response.headers['x-request-id']).toBe('req-test-123');
    expect(response.body).toMatchObject({
      error: 'falha de teste',
      requestId: 'req-test-123',
    });

    consoleErrorSpy.mockRestore();
  });
});
