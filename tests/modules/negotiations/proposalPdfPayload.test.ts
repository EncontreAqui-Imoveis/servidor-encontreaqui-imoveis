import { describe, expect, it } from 'vitest';

import { buildProposalPdfPayload } from '../../../src/modules/negotiations/infra/proposalPdfPayload';

describe('proposalPdfPayload', () => {
  it('maps proposal data to the PDF payload with optional broker and payment metadata', () => {
    expect(
      buildProposalPdfPayload({
        clientName: 'Ana Silva',
        clientCpf: '123.456.789-00',
        propertyAddress: 'Rua A, 10',
        brokerName: 'Pedro',
        sellingBrokerName: 'Maria',
        paymentMethod: 'cash',
        value: 250000,
        payment: {
          cash: 50000,
          tradeIn: 25000,
          financing: 150000,
          others: 25000,
        },
        validityDays: 10,
      })
    ).toEqual({
      client_name: 'Ana Silva',
      client_cpf: '123.456.789-00',
      property_address: 'Rua A, 10',
      broker_name: 'Pedro',
      selling_broker_name: 'Maria',
      payment_method: 'cash',
      value: 250000,
      payment: {
        cash: 50000,
        trade_in: 25000,
        financing: 150000,
        others: 25000,
      },
      validity_days: 10,
    });
  });

  it('rejects missing required fields instead of sending malformed payloads', () => {
    expect(() =>
      buildProposalPdfPayload({
        clientName: 'Ana Silva',
        clientCpf: '123.456.789-00',
        propertyAddress: '',
        brokerName: 'Pedro',
        value: 250000,
        payment: {
          cash: 50000,
          tradeIn: 25000,
          financing: 150000,
          others: 25000,
        },
        validityDays: 10,
      } as any)
    ).toThrow('propertyAddress is required to generate proposal PDF.');
  });

  it('rejects invalid numeric values', () => {
    expect(() =>
      buildProposalPdfPayload({
        clientName: 'Ana Silva',
        clientCpf: '123.456.789-00',
        propertyAddress: 'Rua A, 10',
        brokerName: 'Pedro',
        value: Number.NaN,
        payment: {
          cash: 50000,
          tradeIn: 25000,
          financing: 150000,
          others: 25000,
        },
        validityDays: 10,
      } as any)
    ).toThrow('value is required to generate proposal PDF.');
  });
});
