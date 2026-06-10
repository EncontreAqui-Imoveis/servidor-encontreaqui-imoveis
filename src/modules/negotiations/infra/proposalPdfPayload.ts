import { ValidationError } from '../domain/errors/ValidationError';
import type { ProposalData } from '../domain/states/NegotiationState';

function toRequiredText(value: unknown, fieldName: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new ValidationError(`${fieldName} is required to generate proposal PDF.`);
  }
  return text;
}

function toRequiredNumber(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ValidationError(`${fieldName} is required to generate proposal PDF.`);
  }
  return parsed;
}

function toOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

export function buildProposalPdfPayload(data: ProposalData): {
  client_name: string;
  client_cpf: string;
  property_address: string;
  broker_name: string;
  selling_broker_name: string | null;
  payment_method: string | null;
  value: number;
  payment: {
    cash: number;
    trade_in: number;
    financing: number;
    others: number;
  };
  validity_days: number;
} {
  const payment = data.payment ?? {};

  return {
    client_name: toRequiredText(data.clientName, 'clientName'),
    client_cpf: toRequiredText(data.clientCpf, 'clientCpf'),
    property_address: toRequiredText(data.propertyAddress, 'propertyAddress'),
    broker_name: toRequiredText(data.brokerName, 'brokerName'),
    selling_broker_name: toOptionalText(data.sellingBrokerName),
    payment_method: toOptionalText(data.paymentMethod),
    value: toRequiredNumber(data.value, 'value'),
    payment: {
      cash: toRequiredNumber(payment.cash, 'payment.cash'),
      trade_in: toRequiredNumber(payment.tradeIn, 'payment.tradeIn'),
      financing: toRequiredNumber(payment.financing, 'payment.financing'),
      others: toRequiredNumber(payment.others, 'payment.others'),
    },
    validity_days: toRequiredNumber(data.validityDays, 'validityDays'),
  };
}
