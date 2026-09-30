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
    expect(payload.clientName).toBe('Ana Silva');
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

  it('maps a fixed end date and fixed due day to the PDF contract', () => {
    const payload = buildProposalPdfPayload({
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 10',
      dealType: 'rent',
      brokerName: 'Corretor Teste',
      value: 1500,
      payment: { cash: 1500, tradeIn: 0, financing: 0, others: 0 },
      validityDays: 10,
      rentalTerms: {
        monthlyRent: 1500,
        leaseTermType: 'fixed',
        leaseEndDate: '2099-12-30',
        leaseTermMonths: null,
        monthlyDueDayType: 'fixed',
        monthlyDueDay: 10,
      },
    });

    expect(payload.rental_terms).toMatchObject({
      lease_term_type: 'fixed',
      lease_end_date: '2099-12-30',
      lease_term_months: null,
      monthly_due_day_type: 'fixed',
      monthly_due_day: 10,
    });
  });

  it('maps indeterminate and to-be-defined terms explicitly without numeric sentinels', () => {
    const payload = buildProposalPdfPayload({
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 10',
      dealType: 'rent',
      brokerName: 'Corretor Teste',
      value: 1500,
      payment: { cash: 1500, tradeIn: 0, financing: 0, others: 0 },
      validityDays: 10,
      rentalTerms: {
        monthlyRent: 1500,
        leaseTermType: 'indeterminate',
        monthlyDueDayType: 'to_be_defined',
      },
    });

    expect(payload.rental_terms).toMatchObject({
      lease_term_type: 'indeterminate',
      lease_end_date: null,
      lease_term_months: null,
      monthly_due_day_type: 'to_be_defined',
      monthly_due_day: null,
    });
  });

  it('keeps legacy months and due day without semantic types or zero values', () => {
    const payload = buildProposalPdfPayload({
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 10',
      dealType: 'rent',
      brokerName: 'Corretor Teste',
      value: 1500,
      payment: { cash: 1500, tradeIn: 0, financing: 0, others: 0 },
      validityDays: 10,
      rentalTerms: {
        monthlyRent: 1500,
        leaseTermMonths: 30,
        monthlyDueDay: 5,
      },
    });

    expect(payload.rental_terms).toMatchObject({
      lease_term_months: 30,
      monthly_due_day: 5,
    });
    expect(payload.rental_terms).not.toHaveProperty('lease_term_type');
    expect(payload.rental_terms).not.toHaveProperty('monthly_due_day_type');

    const zeroPayload = buildProposalPdfPayload({
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      propertyAddress: 'Rua A, 10',
      dealType: 'rent',
      brokerName: 'Corretor Teste',
      value: 1500,
      payment: { cash: 1500, tradeIn: 0, financing: 0, others: 0 },
      validityDays: 10,
      rentalTerms: { monthlyRent: 1500, leaseTermMonths: 0, monthlyDueDay: 0 },
    });
    expect(zeroPayload.rental_terms).toMatchObject({
      lease_term_months: null,
      monthly_due_day: null,
    });
  });
});
