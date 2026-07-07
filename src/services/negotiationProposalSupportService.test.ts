import { describe, expect, it } from 'vitest';

import { parseProposalWizardBody } from './negotiationProposalSupportService';

describe('negotiationProposalSupportService', () => {
  it('preserves rent deal type from wizard payload', () => {
    const parsed = parseProposalWizardBody({
      propertyId: 123,
      clientName: 'Ana Silva',
      clientCpf: '52998224725',
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
});
