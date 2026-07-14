import { describe, expect, it } from 'vitest';

import { resolveContractAccessContext } from '../../src/utils/contractAccessResolver';

const baseContract = {
  id: 'contract-1',
  status: 'AWAITING_DOCS',
  advertiser_id: 10,
  proposer_id: 20,
  initiator_side: 'buyer',
  responsible_user_ids: '30',
};

describe('resolveContractAccessContext', () => {
  it('reconhece comprador exclusivamente pelo proposer_id', () => {
    const context = resolveContractAccessContext(
      { id: 20, role: 'client' },
      baseContract
    );

    expect(context).toMatchObject({
      userRole: 'buyer',
      canReadMeta: true,
      canReadSeller: false,
      canEditSeller: false,
      canReadBuyer: true,
      canEditBuyer: true,
    });
  });

  it('não concede acesso para captador, corretor de venda ou iniciador implícitos', () => {
    const context = resolveContractAccessContext(
      { id: 40, role: 'broker' },
      {
        ...baseContract,
        capturing_broker_id: 40,
        selling_broker_id: 40,
        proposal_initiator_user_id: 40,
      } as typeof baseContract
    );

    expect(context.userRole).toBe('none');
    expect(context.canReadMeta).toBe(false);
  });

  it('concede ambos os lados somente ao responsável vinculado à negociação', () => {
    const context = resolveContractAccessContext(
      { id: 30, role: 'broker' },
      baseContract
    );

    expect(context).toMatchObject({
      userRole: 'responsible',
      canReadSeller: true,
      canEditSeller: true,
      canReadBuyer: true,
      canEditBuyer: true,
    });
  });

  it('bloqueia identidade dupla para usuário comum, mas mantém admin para correção operacional', () => {
    const duplicatedContract = {
      ...baseContract,
      advertiser_id: 20,
    };

    expect(
      resolveContractAccessContext({ id: 20, role: 'client' }, duplicatedContract)
        .userRole
    ).toBe('none');
    expect(
      resolveContractAccessContext({ id: 1, role: 'admin' }, duplicatedContract)
        .userRole
    ).toBe('admin');
  });

  it('concede ao comprador jurídico somente o escopo buyer', () => {
    const context = resolveContractAccessContext(
      { id: 40, role: 'client' },
      { ...baseContract, legal_buyer_user_id: 40 }
    );

    expect(context).toMatchObject({
      userRole: 'buyer',
      canReadMeta: true,
      canReadSeller: false,
      canEditSeller: false,
      canReadBuyer: true,
      canEditBuyer: true,
    });
  });

  it('mapeia proposta iniciada pelo vendedor para o lado seller', () => {
    const context = resolveContractAccessContext(
      { id: 10, role: 'client' },
      { ...baseContract, proposer_id: 10, initiator_side: 'seller', legal_buyer_user_id: 40 }
    );

    expect(context.userRole).toBe('seller');
    expect(context.canEditSeller).toBe(true);
    expect(context.canEditBuyer).toBe(false);
  });

  it('congela edição para participantes e responsável durante assinatura, sem congelar admin', () => {
    const frozenContract = { ...baseContract, status: 'AWAITING_SIGNATURES' };

    const responsible = resolveContractAccessContext(
      { id: 30, role: 'broker' },
      frozenContract
    );
    const admin = resolveContractAccessContext(
      { id: 1, role: 'admin' },
      frozenContract
    );

    expect(responsible.canEditSeller).toBe(false);
    expect(responsible.canEditBuyer).toBe(false);
    expect(admin.canEditSeller).toBe(true);
    expect(admin.canEditBuyer).toBe(true);
  });

  it('congela edição para participantes durante a confecção', () => {
    const context = resolveContractAccessContext(
      { id: 20, role: 'client' },
      { ...baseContract, status: 'IN_DRAFT' }
    );

    expect(context.canEditBuyer).toBe(false);
    expect(context.isReadOnly).toBe(true);
    expect(context.workflowStatus).toBe('IN_DRAFT');
  });
});
