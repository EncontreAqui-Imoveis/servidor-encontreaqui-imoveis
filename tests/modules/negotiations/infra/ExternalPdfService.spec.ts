import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProposalData } from '../../../../../src/modules/negotiations/domain/states/NegotiationState';
import { ExternalPdfService } from '../../../../../src/modules/negotiations/infra/ExternalPdfService';

const { postMock, isAxiosErrorMock } = vi.hoisted(() => ({
  postMock: vi.fn(),
  isAxiosErrorMock: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    post: postMock,
    isAxiosError: isAxiosErrorMock,
  },
}));

const sampleProposal: ProposalData = {
  clientName: 'Ana Silva',
  clientCpf: '123.456.789-00',
  propertyAddress: 'Rua A, 10',
  brokerName: 'Pedro',
  sellingBrokerName: 'Maria',
  value: 250000,
  payment: {
    cash: 50000,
    tradeIn: 25000,
    financing: 150000,
    others: 25000,
  },
  validityDays: 10,
};

describe('ExternalPdfService', () => {
  beforeEach(() => {
    postMock.mockReset();
    isAxiosErrorMock.mockReset();
    vi.restoreAllMocks();
  });

  it('throws when the internal API key is missing', async () => {
    const service = new ExternalPdfService({
      baseUrl: 'pdf-service.internal',
      internalApiKey: '',
    });

    await expect(service.generateProposal(sampleProposal)).rejects.toThrow(
      'PDF_INTERNAL_API_KEY não está configurado'
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  it('normalizes the endpoint and sends the mapped payload with internal auth', async () => {
    postMock.mockResolvedValueOnce({
      data: Buffer.from('%PDF-1.4 fake'),
    });

    const service = new ExternalPdfService({
      baseUrl: 'pdf-service.internal',
      internalApiKey: 'internal-key',
      timeoutMs: 4500,
    });

    const result = await service.generateProposal(sampleProposal);

    expect(postMock).toHaveBeenCalledWith(
      'http://pdf-service.internal/generate-proposal',
      {
        client_name: 'Ana Silva',
        client_cpf: '123.456.789-00',
        property_address: 'Rua A, 10',
        broker_name: 'Pedro',
        selling_broker_name: 'Maria',
        value: 250000,
        payment: {
          cash: 50000,
          trade_in: 25000,
          financing: 150000,
          others: 25000,
        },
        validity_days: 10,
      },
      {
        responseType: 'arraybuffer',
        timeout: 4500,
        headers: {
          'X-Internal-API-Key': 'internal-key',
        },
      }
    );
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toContain('%PDF-1.4');
  });

  it('preserves a fully qualified generate-proposal endpoint and rethrows axios errors', async () => {
    const axiosError = {
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        data: { message: 'downstream offline' },
      },
      code: 'ECONNABORTED',
    };

    postMock.mockRejectedValueOnce(axiosError);
    isAxiosErrorMock.mockReturnValueOnce(true);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = new ExternalPdfService({
      baseUrl: 'https://pdf.example.com/generate-proposal',
      internalApiKey: 'internal-key',
    });

    await expect(service.generateProposal(sampleProposal)).rejects.toBe(axiosError);

    expect(postMock).toHaveBeenCalledWith(
      'https://pdf.example.com/generate-proposal',
      expect.any(Object),
      expect.objectContaining({
        headers: {
          'X-Internal-API-Key': 'internal-key',
        },
      })
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'ExternalPdfService.generateProposal failed',
      expect.objectContaining({
        endpointUrl: 'https://pdf.example.com/generate-proposal',
        responseStatus: 503,
        axiosCode: 'ECONNABORTED',
      })
    );
  });
});
