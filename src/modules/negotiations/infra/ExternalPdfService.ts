import axios from 'axios';
import jwt from 'jsonwebtoken';

import type { ProposalData, ProposalPdfService } from '../domain/states/NegotiationState';

export class ExternalPdfService implements ProposalPdfService {
  private readonly baseUrl: string;
  private readonly endpointUrl: string;
  private readonly jwtSecret: string;

  constructor(params?: { baseUrl?: string; jwtSecret?: string }) {
    const rawBaseUrl = (params?.baseUrl ?? process.env.PDF_SERVICE_URL ?? 'http://localhost:8080')
      .trim()
      .replace(/\/+$/, '');
    const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(rawBaseUrl);
    this.baseUrl = hasScheme ? rawBaseUrl : `http://${rawBaseUrl}`;
    this.endpointUrl = this.baseUrl.endsWith('/generate-proposal')
      ? this.baseUrl
      : `${this.baseUrl}/generate-proposal`;
    this.jwtSecret = params?.jwtSecret ?? process.env.JWT_SECRET ?? '';
  }

  async generateProposal(data: ProposalData): Promise<Buffer> {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET não está configurado para serviço de autenticação do PDF');
    }

    const token = jwt.sign({ scope: 'pdf-service' }, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '1m',
    });

    const payload = {
      client_name: data.clientName,
      client_cpf: data.clientCpf,
      property_address: data.propertyAddress,
      broker_name: data.brokerName,
      selling_broker_name: data.sellingBrokerName ?? '',
      value: data.value,
      payment_method: data.paymentMethod,
      validity_days: data.validityDays,
    };

    try {
      const response = await axios.post(this.endpointUrl, payload, {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${token}`,
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
