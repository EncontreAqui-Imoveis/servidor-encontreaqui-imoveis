import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import locationRoutes from '../../src/routes/location.routes';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('GET /locations/cep/:cep', () => {
  const app = express();
  const axiosGetMock = vi.mocked(axios.get);

  app.use('/locations', locationRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid CEP format', async () => {
    const response = await request(app).get('/locations/cep/123');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'CEP invalido. Informe 8 digitos.',
    });
  });

  it('returns address payload for valid CEP', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        logradouro: 'Rua Exemplo',
        bairro: 'Centro',
        localidade: 'Rio Verde',
        uf: 'GO',
      },
    } as never);

    const response = await request(app).get('/locations/cep/75908-220');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      logradouro: 'Rua Exemplo',
      bairro: 'Centro',
      localidade: 'Rio Verde',
      uf: 'GO',
    });
    expect(axiosGetMock).toHaveBeenCalledTimes(1);
  });
});
