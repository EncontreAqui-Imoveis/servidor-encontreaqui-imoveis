import { describe, expect, it } from 'vitest';

import { calculateContractReadiness } from '../../src/services/contractReadinessService';

describe('calculateContractReadiness', () => {
  it('informa pendências sem impedir o salvamento parcial do rascunho', () => {
    const readiness = calculateContractReadiness({
      dealType: 'rent',
      sellerInfo: {
        profissao: 'Vendedora',
        email: 'seller@example.com',
        telefone: '64999999999',
        estado_civil: 'Solteiro(a)',
        dados_bancarios: 'Banco 1',
      },
      buyerInfo: {
        profissao: 'Comprador',
        estado_civil: 'União Estável',
      },
      documents: [],
    });

    expect(readiness.buyer.missingFields).toEqual(
      expect.arrayContaining([
        'email',
        'telefone',
        'garantia_locacao',
        'conjuge_nome',
        'conjuge_cpf',
        'conjuge_profissao',
      ])
    );
    expect(readiness.eligibleForAdminApproval).toBe(false);
    expect(readiness.buyer.missingFields).not.toContain('dados_bancarios');
  });

  it('exige os dados conjugais de Casado(a) apenas na readiness administrativa', () => {
    const readiness = calculateContractReadiness({
      dealType: 'sale',
      sellerInfo: {
        profissao: 'Vendedora',
        email: 'seller@example.com',
        telefone: '64999999999',
        estado_civil: 'Solteiro(a)',
        dados_bancarios: 'Banco 1',
      },
      buyerInfo: {
        profissao: 'Comprador',
        email: 'buyer@example.com',
        telefone: '64888888888',
        estado_civil: 'Casado(a)',
        dados_bancarios: 'Banco 2',
      },
      documents: [],
    });

    expect(readiness.buyer.missingFields).toEqual(
      expect.arrayContaining(['conjuge_nome', 'conjuge_cpf', 'conjuge_profissao'])
    );
    expect(readiness.eligibleForAdminApproval).toBe(false);
  });

  it('considera seguro incêndio aprovado com ressalvas como pronto para locação', () => {
    const input = {
      dealType: 'rent' as const,
      sellerInfo: {
        profissao: 'Locador',
        email: 'seller@example.com',
        telefone: '64999999999',
        estado_civil: 'Solteiro(a)',
        dados_bancarios: 'Banco 1',
      },
      buyerInfo: {
        profissao: 'Locatário',
        email: 'buyer@example.com',
        telefone: '64888888888',
        estado_civil: 'Solteiro(a)',
        garantia_locacao: 'Seguro-fiança',
      },
      documents: [
        { side: 'seller' as const, documentCategory: 'seguro_incendio' as const, categoryStatus: 'APPROVED_WITH_RES' },
      ],
    };

    const withReservation = calculateContractReadiness(input);
    expect(withReservation.seller.missingDocumentCategories).not.toContain('seguro_incendio');

    const approved = calculateContractReadiness({
      ...input,
      documents: [
        { side: 'seller' as const, documentCategory: 'seguro_incendio' as const, categoryStatus: 'APPROVED' },
      ],
    });
    expect(approved.seller.missingDocumentCategories).not.toContain('seguro_incendio');
  });
});
