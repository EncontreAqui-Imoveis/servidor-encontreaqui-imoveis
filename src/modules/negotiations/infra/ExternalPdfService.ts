import axios from 'axios';

import type { ProposalData, ProposalPdfService } from '../domain/states/NegotiationState';

export class ExternalPdfService implements ProposalPdfService {
  private readonly baseUrl: string;
  private readonly endpointUrl: string;
  private readonly internalApiKey: string;
  private readonly timeoutMs: number;

  constructor(params?: {
    baseUrl?: string;
    internalApiKey?: string;
    timeoutMs?: number;
  }) {
    const rawBaseUrl = (
      params?.baseUrl ??
      process.env.PDF_SERVICE_URL ??
      'http://localhost:8080'
    )
      .trim()
      .replace(/\/+$/, '');
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseUrl);
    this.baseUrl = hasScheme ? rawBaseUrl : `http://${rawBaseUrl}`;
    this.endpointUrl = this.baseUrl.endsWith('/generate-proposal')
      ? this.baseUrl
      : `${this.baseUrl}/generate-proposal`;
    this.internalApiKey =
      params?.internalApiKey ?? process.env.PDF_INTERNAL_API_KEY ?? '';

    const configuredTimeout = Number(
      params?.timeoutMs ?? process.env.PDF_SERVICE_TIMEOUT_MS
    );
    this.timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? Math.trunc(configuredTimeout)
        : 10000;
  }

  async generateProposal(data: ProposalData): Promise<Buffer> {
    if (!this.internalApiKey) {
      throw new Error(
        'PDF_INTERNAL_API_KEY não está configurado para autenticação interna do serviço de PDF'
      );
    }

    const payload = {
      client_name: data.clientName,
      client_cpf: data.clientCpf,
      property_address: data.propertyAddress,
      broker_name: data.brokerName,
      selling_broker_name: data.sellingBrokerName ?? '',
      value: data.value,
      payment: {
        cash: data.payment.cash,
        trade_in: data.payment.tradeIn,
        financing: data.payment.financing,
        others: data.payment.others,
      },
      validity_days: data.validityDays,
    };

    try {
      const response = await axios.post(this.endpointUrl, payload, {
        responseType: 'arraybuffer',
        timeout: this.timeoutMs,
        headers: {
          'X-Internal-API-Key': this.internalApiKey,
        },
      });

      return Buffer.from(response.data);
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const responseStatus = error.response?.status;
        const responseStatusText = error.response?.statusText ?? null;
        const responseData = (() => {
          const data = error.response?.data;
          if (data == null) return null;
          if (typeof data === 'string') return data.slice(0, 500);
          if (Buffer.isBuffer(data)) return data.toString('utf8', 0, 500);
          if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8', 0, 500);
          if (ArrayBuffer.isView(data)) {
            return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8', 0, 500);
          }
          try {
            return JSON.stringify(data).slice(0, 500);
          } catch {
            return String(data).slice(0, 500);
          }
        })();

        console.error('ExternalPdfService.generateProposal failed', {
          endpointUrl: this.endpointUrl,
          baseUrl: this.baseUrl,
          axiosCode: error.code ?? null,
          responseStatus,
          responseStatusText,
          responseData,
        });
      } else {
        console.error('ExternalPdfService.generateProposal failed with non-axios error', {
          endpointUrl: this.endpointUrl,
          baseUrl: this.baseUrl,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }
}
