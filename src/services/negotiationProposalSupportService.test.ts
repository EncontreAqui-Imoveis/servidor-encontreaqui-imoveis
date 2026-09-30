import { describe, expect, it } from 'vitest';

import { parseProposalWizardBody } from './negotiationProposalSupportService';

function rentalWizardPayload(rentalTerms: Record<string, unknown>) {
  return {
    propertyId: 123,
    clientName: 'Ana Silva',
    clientCpf: '52998224725',
    buyerEmail: 'ana@example.com',
    dealType: 'rent',
    validadeDias: 10,
    pagamento: {
      dinheiro: 0,
      permuta: 0,
      financiamento: 0,
      outros: 0,
    },
    rentalTerms,
  };
}

describe('negotiationProposalSupportService', () => {
  it('preserves rent deal type from wizard payload', () => {
    const parsed = parseProposalWizardBody({
      propertyId: 123,
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      buyerEmail: 'ana@example.com',
      dealType: 'rent',
      buyerUserId: 99,
      validadeDias: 10,
      pagamento: {
        dinheiro: 1000,
        permuta: 0,
        financiamento: 0,
        outros: 0,
      },
    });

    expect(parsed.dealType).toBe('rent');
    expect(parsed.propertyId).toBe(123);
    expect(parsed.buyerUserId).toBe(99);
    expect(parsed.clientCpf).toBe('52998224725');
  });

  it('defaults to sale when deal type is missing', () => {
    const parsed = parseProposalWizardBody({
      propertyId: 123,
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
      buyerEmail: 'ana@example.com',
      validadeDias: 10,
      pagamento: {
        dinheiro: 1000,
        permuta: 0,
        financiamento: 0,
        outros: 0,
      },
    });

    expect(parsed.dealType).toBe('sale');
  });

  it('requires a valid buyer email for the explicit buyer association flow', () => {
    expect(() =>
      parseProposalWizardBody({
        propertyId: 123,
        clientName: 'Ana Silva',
        clientCpf: '52998224725',
        validadeDias: 10,
        pagamento: {
          dinheiro: 1000,
          permuta: 0,
          financiamento: 0,
          outros: 0,
        },
      })
    ).toThrow('buyerEmail e obrigatorio e deve ser valido.');
  });

  it('accepts fixed rental terms with valid numeric values', () => {
    const parsed = parseProposalWizardBody(
      rentalWizardPayload({
        leaseTermType: 'fixed',
        leaseTermMonths: 30,
        monthlyDueDayType: 'fixed',
        monthlyDueDay: 10,
      })
    );

    expect(parsed.rentalTerms).toMatchObject({
      leaseTermType: 'fixed',
      leaseTermMonths: 30,
      monthlyDueDayType: 'fixed',
      monthlyDueDay: 10,
    });
  });

  it('rejects fixed lease terms without months', () => {
    expect(() =>
      parseProposalWizardBody(rentalWizardPayload({ leaseTermType: 'fixed' }))
    ).toThrow('rentalTerms.leaseTermMonths e obrigatorio para leaseTermType fixed.');
  });

  it('accepts an indeterminate lease only when months are absent', () => {
    expect(
      parseProposalWizardBody(
        rentalWizardPayload({ leaseTermType: 'indeterminate', leaseTermMonths: null })
      ).rentalTerms
    ).toMatchObject({ leaseTermType: 'indeterminate', leaseTermMonths: null });

    expect(() =>
      parseProposalWizardBody(
        rentalWizardPayload({ leaseTermType: 'indeterminate', leaseTermMonths: 30 })
      )
    ).toThrow('rentalTerms.leaseTermMonths deve estar ausente ou nulo para este tipo.');
  });

  it('rejects fixed due days without a day', () => {
    expect(() =>
      parseProposalWizardBody(rentalWizardPayload({ monthlyDueDayType: 'fixed' }))
    ).toThrow('rentalTerms.monthlyDueDay e obrigatorio para monthlyDueDayType fixed.');
  });

  it('accepts a due day to be defined only when the day is absent', () => {
    expect(
      parseProposalWizardBody(
        rentalWizardPayload({ monthlyDueDayType: 'to_be_defined', monthlyDueDay: null })
      ).rentalTerms
    ).toMatchObject({ monthlyDueDayType: 'to_be_defined', monthlyDueDay: null });

    expect(() =>
      parseProposalWizardBody(
        rentalWizardPayload({ monthlyDueDayType: 'to_be_defined', monthlyDueDay: 10 })
      )
    ).toThrow('rentalTerms.monthlyDueDay deve estar ausente ou nulo para este tipo.');
  });

  it('keeps legacy rental terms valid without assigning a semantic type', () => {
    const legacyLease = parseProposalWizardBody(
      rentalWizardPayload({ leaseTermMonths: 24 })
    ).rentalTerms;
    const legacyDueDay = parseProposalWizardBody(
      rentalWizardPayload({ monthlyDueDay: 5 })
    ).rentalTerms;
    const legacyUnspecified = parseProposalWizardBody(rentalWizardPayload({})).rentalTerms;

    expect(legacyLease).toMatchObject({ leaseTermMonths: 24 });
    expect(legacyLease).not.toHaveProperty('leaseTermType');
    expect(legacyDueDay).toMatchObject({ monthlyDueDay: 5 });
    expect(legacyDueDay).not.toHaveProperty('monthlyDueDayType');
    expect(legacyUnspecified).toMatchObject({
      leaseTermMonths: null,
      monthlyDueDay: null,
    });
    expect(legacyUnspecified).not.toHaveProperty('leaseTermType');
    expect(legacyUnspecified).not.toHaveProperty('monthlyDueDayType');
  });
});
