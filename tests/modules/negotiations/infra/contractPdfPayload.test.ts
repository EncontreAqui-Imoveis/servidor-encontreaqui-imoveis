import { describe, expect, it } from 'vitest';

import {
  buildContractPdfPayload,
  resolveContractDraftTemplate,
} from '../../../../src/modules/negotiations/infra/contractPdfPayload';

describe('contractPdfPayload', () => {
  it('maps the rental template and commercial terms without sale terminology', () => {
    expect(resolveContractDraftTemplate('rent')).toEqual({
      templateKey: 'rental_contract_v1',
      templateVersion: '1',
    });

    expect(
      buildContractPdfPayload({
        contractId: 'contract-rent',
        dealType: 'rent',
        propertyTitle: 'Casa',
        propertyAddress: 'Rua A, 10',
        seller: { name: 'Locador' },
        buyer: { name: 'Locatário' },
        saleTerms: { cash: 0, tradeIn: 0, financing: 0, others: 0 },
        rentalTerms: { monthlyRent: 1800, guaranteeType: 'Caução' },
      })
    ).toMatchObject({
      deal_type: 'rent',
      rental_terms: {
        monthly_rent: 1800,
        guarantee_type: 'Caução',
        lease_term_months: null,
        monthly_due_day: null,
      },
    });
  });

  it('never serializes absent rental term values as zero', () => {
    const payload = buildContractPdfPayload({
      contractId: 'contract-rent',
      dealType: 'rent',
      propertyTitle: 'Casa',
      propertyAddress: 'Rua A, 10',
      seller: { name: 'Locador' },
      buyer: { name: 'Locatário' },
      saleTerms: { cash: 0, tradeIn: 0, financing: 0, others: 0 },
      rentalTerms: {
        monthlyRent: 1800,
        leaseTermType: 'indeterminate',
        monthlyDueDayType: 'to_be_defined',
      },
    });

    expect(payload).toMatchObject({
      rental_terms: {
        lease_term_months: null,
        monthly_due_day: null,
      },
    });
  });
});
