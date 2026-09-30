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

  it('accepts a new fixed rental term with a future end date', () => {
    const parsed = parseProposalWizardBody(
      rentalWizardPayload({
        leaseTermType: 'fixed',
        leaseEndDate: '2099-12-30',
        monthlyDueDayType: 'fixed',
        monthlyDueDay: 10,
      })
    );

    expect(parsed.rentalTerms).toMatchObject({
      leaseTermType: 'fixed',
      leaseEndDate: '2099-12-30',
      leaseTermMonths: null,
      monthlyDueDayType: 'fixed',
      monthlyDueDay: 10,
    });
  });

  it('rejects invalid, past, or missing end dates for new fixed terms', () => {
    expect(() =>
      parseProposalWizardBody(rentalWizardPayload({ leaseTermType: 'fixed' }))
    ).toThrow('rentalTerms.leaseEndDate e obrigatoria para leaseTermType fixed.');
    expect(() =>
      parseProposalWizardBody(
        rentalWizardPayload({ leaseTermType: 'fixed', leaseEndDate: '2025-02-30' })
      )
    ).toThrow('rentalTerms.leaseEndDate invalida.');
    expect(() =>
      parseProposalWizardBody(
        rentalWizardPayload({ leaseTermType: 'fixed', leaseEndDate: '2000-01-01' })
      )
    ).toThrow('rentalTerms.leaseEndDate deve ser futura.');
  });

  it('keeps previously deployed fixed-by-months payloads compatible', () => {
    expect(
      parseProposalWizardBody(
        rentalWizardPayload({ leaseTermType: 'fixed', leaseTermMonths: 30 })
      ).rentalTerms
    ).toMatchObject({ leaseTermType: 'fixed', leaseTermMonths: 30, leaseEndDate: null });

    expect(() =>
      parseProposalWizardBody(
        rentalWizardPayload({
          leaseTermType: 'fixed',
          leaseEndDate: '2099-12-30',
          leaseTermMonths: 30,
        })
      )
    ).toThrow('rentalTerms.leaseTermMonths deve estar ausente ou nulo quando leaseEndDate for informada.');
  });

  it('accepts an indeterminate lease only when date and months are absent', () => {
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
    expect(() =>
      parseProposalWizardBody(
        rentalWizardPayload({ leaseTermType: 'indeterminate', leaseEndDate: '2099-12-30' })
      )
    ).toThrow('rentalTerms.leaseEndDate deve estar ausente ou nulo para este tipo.');
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
