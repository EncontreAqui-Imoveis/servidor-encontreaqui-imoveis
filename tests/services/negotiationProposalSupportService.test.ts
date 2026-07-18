import { describe, expect, it } from 'vitest';

import {
  isBrokerLikeRole,
  parseProposalWizardBody,
} from '../../src/services/negotiationProposalSupportService';

describe('negotiationProposalSupportService', () => {
  it('treats auxiliary administrative as broker-like for proposal flows', () => {
    expect(isBrokerLikeRole('broker')).toBe(true);
    expect(isBrokerLikeRole('auxiliary_administrative')).toBe(true);
    expect(isBrokerLikeRole('client')).toBe(false);
  });

  it('accepts wizard payment payloads and normalizes cpf digits', () => {
    const parsed = parseProposalWizardBody({
      propertyId: 12,
      clientName: 'Pedro Matheus',
      clientCpf: '091.694.431-06',
      validadeDias: 10,
      pagamento: {
        dinheiro: 'R$ 1.000,50',
        permuta: 0,
        financiamento: 0,
        outros: 0,
      },
    });

    expect(parsed.propertyId).toBe(12);
    expect(parsed.clientCpf).toBe('09169443106');
    expect(parsed.pagamento.dinheiro).toBe(1000.5);
  });

  it('accepts rental-only terms without requiring a sale payment allocation', () => {
    const parsed = parseProposalWizardBody({
      propertyId: 12,
      clientName: 'Pedro Matheus',
      clientCpf: '091.694.431-06',
      dealType: 'rent',
      validadeDias: 10,
      pagamento: {
        dinheiro: 0,
        permuta: 0,
        financiamento: 0,
        outros: 0,
      },
      rentalTerms: {
        monthlyRent: 'R$ 2.500,00',
        guaranteeType: 'Caução',
        guaranteeAmount: '2500',
        leaseTermMonths: 30,
        expectedStartDate: '2026-08-01',
        monthlyDueDay: 10,
        condominiumResponsibility: 'Locatário',
        propertyTaxResponsibility: 'Locador',
        observations: 'Sem animais.',
      },
    });

    expect(parsed.rentalTerms).toEqual({
      monthlyRent: 2500,
      guaranteeType: 'Caução',
      guaranteeAmount: 2500,
      leaseTermMonths: 30,
      expectedStartDate: '2026-08-01',
      monthlyDueDay: 10,
      condominiumResponsibility: 'Locatário',
      propertyTaxResponsibility: 'Locador',
      observations: 'Sem animais.',
    });
  });
});
