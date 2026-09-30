import { describe, expect, it } from 'vitest';

import { resolveContractParties } from '../../src/services/contractPartyResolutionService';

const sellerInitiatedInput = {
  negotiation: {
    initiatorSide: 'seller' as const,
    proposerId: 10,
    advertiserId: 10,
    legalBuyerUserId: 20,
    buyerName: 'Comprador informado',
    buyerCpf: '12345678909',
    buyerEmail: 'comprador@example.com',
  },
  property: { ownerId: 10, ownerName: 'Vendedor', ownerPhone: '64999999999' },
  relatedUsers: {
    proposer: {
      id: 10,
      name: 'Vendedor',
      email: 'vendedor@example.com',
      cpf: '98765432100',
      phone: '64999999999',
    },
    owner: null,
    legalBuyer: {
      id: 20,
      name: 'Comprador vinculado',
      email: 'comprador@example.com',
      cpf: '12345678909',
      phone: '64888888888',
    },
  },
};

describe('contractPartyResolutionService', () => {
  it('vincula a conta do comprador por e-mail sem substituir o nome jurídico informado na proposta', () => {
    const result = resolveContractParties(sellerInitiatedInput);

    expect(result.legalBuyerUserId).toBe(20);
    expect(result.sellerInfo).toMatchObject({ nome: 'Vendedor', email: 'vendedor@example.com' });
    expect(result.buyerInfo).toMatchObject({ nome: 'Comprador informado', telefone: '64888888888' });
    expect(result.metadata.partyResolution.buyer.nameSource).toBe('proposal_legal_data');
    expect(result.metadata.partyResolution.identityCapabilities.buyer.canEditName).toBe(true);
  });

  it('prioriza o nome jurídico da proposta também quando o comprador é o proponente', () => {
    const result = resolveContractParties({
      ...sellerInitiatedInput,
      negotiation: { ...sellerInitiatedInput.negotiation, initiatorSide: 'buyer' },
      relatedUsers: { ...sellerInitiatedInput.relatedUsers, owner: sellerInitiatedInput.relatedUsers.proposer },
    });

    expect(result.buyerInfo.nome).toBe('Comprador informado');
    expect(result.metadata.partyResolution.buyer.nameSource).toBe('proposal_legal_data');
  });

  it('prioriza o CPF jurídico válido informado na proposta sobre o CPF do perfil', () => {
    const result = resolveContractParties({
      ...sellerInitiatedInput,
      negotiation: {
        ...sellerInitiatedInput.negotiation,
        buyerCpf: '529.982.247-25',
      },
    });

    expect(result.buyerInfo.cpf).toBe('52998224725');
    expect(result.metadata.partyResolution.buyer.cpfSource).toBe('proposal_legal_data');
  });

  it('usa o CPF válido do perfil somente como fallback quando a proposta não o informa', () => {
    const result = resolveContractParties({
      ...sellerInitiatedInput,
      negotiation: { ...sellerInitiatedInput.negotiation, buyerCpf: null },
    });

    expect(result.buyerInfo.cpf).toBe('12345678909');
    expect(result.metadata.partyResolution.buyer.cpfSource).toBe('verified_email_profile');
  });

  it('não persiste CPF jurídico inválido quando não há fallback válido', () => {
    const result = resolveContractParties({
      ...sellerInitiatedInput,
      negotiation: { ...sellerInitiatedInput.negotiation, buyerCpf: '111.111.111-11' },
      relatedUsers: { ...sellerInitiatedInput.relatedUsers, legalBuyer: null },
    });

    expect(result.buyerInfo.cpf).toBeNull();
    expect(result.metadata.partyResolution.buyer.cpfSource).toBe('missing');
  });

  it('mantém somente dados textuais quando o e-mail não resolve uma conta verificada', () => {
    const result = resolveContractParties({
      ...sellerInitiatedInput,
      negotiation: { ...sellerInitiatedInput.negotiation, legalBuyerUserId: null },
      relatedUsers: { ...sellerInitiatedInput.relatedUsers, legalBuyer: null },
    });

    expect(result.legalBuyerUserId).toBeNull();
    expect(result.buyerInfo).toMatchObject({
      nome: 'Comprador informado',
      cpf: '12345678909',
      email: 'comprador@example.com',
      telefone: null,
    });
    expect(result.metadata.partyResolution.identityCapabilities.buyer.canEditName).toBe(true);
  });
});
