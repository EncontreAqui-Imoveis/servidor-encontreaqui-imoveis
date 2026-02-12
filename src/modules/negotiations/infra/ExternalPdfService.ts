import axios from 'axios';
import jwt from 'jsonwebtoken';

import type { ProposalData, ProposalPdfService } from '../domain/states/NegotiationState';

export class ExternalPdfService implements ProposalPdfService {
  private readonly baseUrl: string;
  private readonly jwtSecret: string;

  constructor(params?: { baseUrl?: string; jwtSecret?: string }) {
    this.baseUrl = (params?.baseUrl ?? process.env.PDF_SERVICE_URL ?? 'http://localhost:8080').replace(
      /\/+$/,
      ''
    );
    this.jwtSecret = params?.jwtSecret ?? process.env.JWT_SECRET ?? '';
  }

  async generateProposal(data: ProposalData): Promise<Buffer> {
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET is not configured for PDF service auth.');
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

    const response = await axios.post(`${this.baseUrl}/generate-proposal`, payload, {
      responseType: 'arraybuffer',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return Buffer.from(response.data);
  }
}
