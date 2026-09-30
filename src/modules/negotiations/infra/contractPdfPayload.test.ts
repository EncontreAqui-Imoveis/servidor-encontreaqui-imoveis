import { describe, expect, it } from 'vitest';

import { buildContractPdfPayload } from './contractPdfPayload';

describe('contractPdfPayload', () => {
  it('maps fixed end date and due day to the external contract payload', () => {
    const payload = buildContractPdfPayload({
      contractId: 'contract-1',
      dealType: 'rent',
      propertyTitle: 'Casa',
      propertyAddress: 'Rua A',
      seller: { name: 'Vendedor' },
      buyer: { name: 'Locatário' },
      saleTerms: { cash: 0, tradeIn: 0, financing: 0, others: 0 },
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

  it('maps indeterminate and to-be-defined values without zero sentinels', () => {
    const payload = buildContractPdfPayload({
      contractId: 'contract-1',
      dealType: 'rent',
      propertyTitle: 'Casa',
      propertyAddress: 'Rua A',
      seller: { name: 'Vendedor' },
      buyer: { name: 'Locatário' },
      saleTerms: { cash: 0, tradeIn: 0, financing: 0, others: 0 },
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

  it('keeps legacy numeric terms and omits semantic types', () => {
    const payload = buildContractPdfPayload({
      contractId: 'contract-1',
      dealType: 'rent',
      propertyTitle: 'Casa',
      propertyAddress: 'Rua A',
      seller: { name: 'Vendedor' },
      buyer: { name: 'Locatário' },
      saleTerms: { cash: 0, tradeIn: 0, financing: 0, others: 0 },
      rentalTerms: { monthlyRent: 1500, leaseTermMonths: 30, monthlyDueDay: 5 },
    });

    expect(payload.rental_terms).toMatchObject({
      lease_term_months: 30,
      monthly_due_day: 5,
    });
    expect(payload.rental_terms).not.toHaveProperty('lease_term_type');
    expect(payload.rental_terms).not.toHaveProperty('monthly_due_day_type');

    const zeroPayload = buildContractPdfPayload({
      contractId: 'contract-1',
      dealType: 'rent',
      propertyTitle: 'Casa',
      propertyAddress: 'Rua A',
      seller: { name: 'Vendedor' },
      buyer: { name: 'Locatário' },
      saleTerms: { cash: 0, tradeIn: 0, financing: 0, others: 0 },
      rentalTerms: { monthlyRent: 1500, leaseTermMonths: 0, monthlyDueDay: 0 },
    });
    expect(zeroPayload.rental_terms).toMatchObject({
      lease_term_months: null,
      monthly_due_day: null,
    });
  });
});
