import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import axios from 'axios';
import { locationController } from '../../src/controllers/LocationController';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

type FnMock = ReturnType<typeof vi.fn>;
type MockResponse = Response & {
  status: FnMock;
  json: FnMock;
};

function createMockResponse(): MockResponse {
  const res: Partial<MockResponse> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as MockResponse;
}

describe('LocationController.getByCep', () => {
  const axiosGetMock = vi.mocked(axios.get);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when CEP is invalid', async () => {
    const req = { params: { cep: '12-34' } } as unknown as Request;
    const res = createMockResponse();

    await locationController.getByCep(req, res);

    expect(axiosGetMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'CEP invalido. Informe 8 digitos.',
    });
  });

  it('returns sanitized ViaCEP payload when lookup succeeds', async () => {
    axiosGetMock.mockResolvedValue({
      data: {
        logradouro: 'Rua Exemplo',
        bairro: 'Centro',
        localidade: 'Rio Verde',
        uf: 'GO',
      },
    } as never);

    const req = { params: { cep: '75908-220' } } as unknown as Request;
    const res = createMockResponse();

    await locationController.getByCep(req, res);

    expect(axiosGetMock).toHaveBeenCalledWith(
      'https://viacep.com.br/ws/75908220/json/',
      expect.objectContaining({ timeout: 5000 })
    );
    expect(res.json).toHaveBeenCalledWith({
      logradouro: 'Rua Exemplo',
      bairro: 'Centro',
      localidade: 'Rio Verde',
      uf: 'GO',
    });
  });

  it('returns 404 when ViaCEP says CEP was not found', async () => {
    axiosGetMock.mockResolvedValue({
      data: { erro: true },
    } as never);

    const req = { params: { cep: '75908220' } } as unknown as Request;
    const res = createMockResponse();

    await locationController.getByCep(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'CEP nao encontrado.',
    });
  });

  it('returns 404 when ViaCEP request fails', async () => {
    axiosGetMock.mockRejectedValue(new Error('timeout'));

    const req = { params: { cep: '75908220' } } as unknown as Request;
    const res = createMockResponse();

    await locationController.getByCep(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Nao foi possivel consultar o CEP no momento.',
    });
  });
});
