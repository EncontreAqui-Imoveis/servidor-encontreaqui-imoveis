import { describe, expect, it } from 'vitest';
import {
  assertProposalValidityDateNotPast,
  buildProposalValidityDate,
  normalizeOptionalPositiveId,
  normalizeProposalCpfKey,
  parseProposalData,
  parseProposalWizardBody,
  resolvePropertyAddress,
  resolvePropertyValue,
  toCents,
} from '../../src/services/negotiationProposalSupportService';

describe('negotiationProposalSupportService', () => {
  it('normalizes cpf keys and optional ids', () => {
    expect(normalizeProposalCpfKey('111.222.333-44')).toBe('11122233344');
    expect(normalizeOptionalPositiveId('12')).toBe(12);
    expect(normalizeOptionalPositiveId('0')).toBeNull();
    expect(normalizeOptionalPositiveId('')).toBeNull();
  });

  it('parses proposal data and keeps payment sum consistent', () => {
    const data = parseProposalData({
      clientName: 'Joao da Silva',
      clientCpf: '111.222.333-44',
      propertyAddress: 'Rua A',
      brokerName: 'Broker X',
      value: 500000,
      payment: {
        cash: 100000,
        financing: 400000,
      },
      validityDays: 10,
    });

    expect(data).toMatchObject({
      clientName: 'Joao da Silva',
      clientCpf: '111.222.333-44',
      sellingBrokerName: 'Broker X',
      payment: {
        cash: 100000,
        tradeIn: 0,
        financing: 400000,
        others: 0,
      },
    });
    expect(toCents(data.value)).toBe(50000000);
  });

  it('parses wizard proposal payloads and rejects invalid dates', () => {
    const payload = parseProposalWizardBody({
      propertyId: '101',
      clientName: 'Maria',
      clientCpf: '111.222.333-44',
      validadeDias: '10',
      pagamento: {
        dinheiro: '100000',
        permuta: 0,
        financiamento: 400000,
        outros: 0,
      },
      proposalValidUntil: buildProposalValidityDate(10),
    });

    expect(payload).toMatchObject({
      propertyId: 101,
      clientName: 'Maria',
      clientCpf: '11122233344',
      validadeDias: 10,
      sellerBrokerId: null,
      pagamento: {
        dinheiro: 100000,
        permuta: 0,
        financiamento: 400000,
        outros: 0,
      },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const iso = yesterday.toISOString().slice(0, 10);
    expect(() =>
      parseProposalWizardBody({
        propertyId: 101,
        clientName: 'Maria',
        clientCpf: '111.222.333-44',
        validadeDias: 10,
        proposal_validity_date: iso,
        pagamento: {
          dinheiro: 100000,
          permuta: 0,
          financiamento: 400000,
          outros: 0,
        },
      })
    ).toThrow('proposal_validity_date nao pode ser anterior a hoje.');
  });

  it('resolves property address and value from listing data', () => {
    expect(
      resolvePropertyAddress({
        address: 'Rua A',
        numero: '10',
        quadra: 'Q1',
        lote: 'L2',
        bairro: 'Centro',
        city: 'Rio Verde',
        state: 'GO',
        price: 500000,
        price_sale: 0,
        price_rent: null,
      })
    ).toBe('Rua A, Nº 10, Centro, Rio Verde, GO, Quadra Q1, Lote L2');

    expect(
      resolvePropertyValue({
        address: null,
        numero: null,
        quadra: null,
        lote: null,
        bairro: null,
        city: null,
        state: null,
        price: 0,
        price_sale: 750000,
        price_rent: null,
      })
    ).toBe(750000);
  });

  it('rejects non numeric payment sums through parseProposalData', () => {
    expect(() =>
      parseProposalData({
        clientName: 'Joao',
        clientCpf: '111.222.333-44',
        propertyAddress: 'Rua A',
        brokerName: 'Broker',
        value: 500000,
        payment: {
          cash: 100000,
          financing: 300000,
        },
        validityDays: 10,
      })
    ).toThrow('payment breakdown must match total value');

    expect(() => assertProposalValidityDateNotPast('invalid-date')).toThrow(
      'proposal_validity_date invalida.'
    );
  });
});
