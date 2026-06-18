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
});
