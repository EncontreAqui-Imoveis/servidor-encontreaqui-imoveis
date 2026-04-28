import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../src/httpApp';

const origin = 'https://encontreaquiimoveis.com.br';
const localOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const preflightHeaders = 'x-draft-token,x-draft-id,authorization,content-type';

describe('CORS preflight para rotas de draft', () => {
  const app = createHttpApp();
  const draftId = 'draft-abc';

  const optionsRequest = async (route: string, method: string) => {
    return request(app)
      .options(route)
      .set('Origin', origin)
      .set('Access-Control-Request-Method', method)
      .set('Access-Control-Request-Headers', preflightHeaders);
  };

  const assertCorsHeaders = (response: request.Response) => {
    expect(response.status).toBe(204);
    const allowHeaders = String(response.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(allowHeaders).toContain('x-draft-token');
    expect(allowHeaders).toContain('content-type');
    expect(allowHeaders).toContain('authorization');
  };

  it('aceita OPTIONS em PATCH/GET /register/draft/:draftId', async () => {
    assertCorsHeaders(await optionsRequest(`/auth/register/draft/${draftId}`, 'PATCH'));
  });

  it('aceita OPTIONS em POST /register/draft/:draftId/verify-email', async () => {
    assertCorsHeaders(await optionsRequest(`/auth/register/draft/${draftId}/verify-email`, 'POST'));
  });

  it('aceita OPTIONS em POST /register/draft/:draftId/verify-phone', async () => {
    assertCorsHeaders(await optionsRequest(`/auth/register/draft/${draftId}/verify-phone`, 'POST'));
  });

  it('aceita OPTIONS em POST /register/draft/:draftId/finalize', async () => {
    assertCorsHeaders(await optionsRequest(`/auth/register/draft/${draftId}/finalize`, 'POST'));
  });

  it('aceita OPTIONS em POST /register/draft/:draftId/submit-documents', async () => {
    assertCorsHeaders(await optionsRequest(`/auth/register/draft/${draftId}/submit-documents`, 'POST'));
  });

  it('aceita OPTIONS em POST /register/draft/:draftId/discard', async () => {
    assertCorsHeaders(await optionsRequest(`/auth/register/draft/${draftId}/discard`, 'POST'));
  });

  it('aceita localhost e 127.0.0.1 no preflight de PATCH draft', async () => {
    for (const localOrigin of localOrigins) {
      const response = await request(app)
        .options(`/auth/register/draft/${draftId}`)
        .set('Origin', localOrigin)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', preflightHeaders);

      assertCorsHeaders(response);
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(localOrigin);
    }
  });
});

