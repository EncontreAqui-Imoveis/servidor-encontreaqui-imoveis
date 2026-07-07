import { describe, expect, it } from 'vitest';

import { buildProposalPdfPayload } from './proposalPdfPayload';

describe('proposalPdfPayload', () => {
  it('keeps rent deal type in the payload sent to PDF service', () => {
    const payload = buildProposalPdfPayload({
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 10, Centro, Rio Verde - GO',
      dealType: 'rent',
      brokerName: 'Corretor Teste',
      sellingBrokerName: null,
      value: 1500,
      payment: {
        cash: 1500,
        tradeIn: 0,
        financing: 0,
        others: 0,
      },
      validityDays: 10,
    });

    expect(payload.deal_type).toBe('rent');
    expect(payload.client_name).toBe('Ana Silva');
    expect(payload.payment.cash).toBe(1500);
  });

  it('keeps null when deal type is absent', () => {
    const payload = buildProposalPdfPayload({
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 10, Centro, Rio Verde - GO',
      brokerName: 'Corretor Teste',
      sellingBrokerName: null,
      value: 1500,
      payment: {
        cash: 1500,
        tradeIn: 0,
        financing: 0,
        others: 0,
      },
      validityDays: 10,
    });

    expect(payload.deal_type).toBeNull();
  });
});
