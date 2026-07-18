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
      clientName: 'Ana Silva',
      clientCpf: '123.456.789-00',
      deal_type: null,
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

  it('maps rental terms without leaking sale payment terminology into the PDF payload', () => {
    expect(
      buildProposalPdfPayload({
        clientName: 'Ana Silva',
        clientCpf: '123.456.789-00',
        propertyAddress: 'Rua A, 10',
        brokerName: 'Pedro',
        dealType: 'rent',
        value: 2500,
        payment: {
          cash: 0,
          tradeIn: 0,
          financing: 0,
          others: 0,
        },
        validityDays: 10,
        rentalTerms: {
          monthlyRent: 2500,
          guaranteeType: 'Seguro-fiança',
          guaranteeAmount: 2500,
          leaseTermMonths: 30,
          expectedStartDate: '2026-08-01',
          monthlyDueDay: 10,
          condominiumResponsibility: 'Locatário',
          propertyTaxResponsibility: 'Locador',
          observations: 'Primeiro aluguel proporcional.',
        },
      })
    ).toMatchObject({
      deal_type: 'rent',
      rental_terms: {
        monthly_rent: 2500,
        guarantee_type: 'Seguro-fiança',
        guarantee_amount: 2500,
        lease_term_months: 30,
        expected_start_date: '2026-08-01',
        monthly_due_day: 10,
        condominium_responsibility: 'Locatário',
        property_tax_responsibility: 'Locador',
        observations: 'Primeiro aluguel proporcional.',
      },
    });
  });
});
