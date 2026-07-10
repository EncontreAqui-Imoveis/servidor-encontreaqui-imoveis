import { describe, expect, it } from 'vitest';

import { resolveContractAccessContext } from '../../src/utils/contractAccessResolver';

const baseContract = {
  id: 'contract-1',
  status: 'AWAITING_DOCS',
  seller_client_id: 10,
  buyer_client_id: 20,
  seller_cpf: '111.111.111-11',
  buyer_cpf: '222.222.222-22',
  responsible_user_ids: '30',
};

describe('resolveContractAccessContext', () => {
  it('reconhece comprador pelo CPF normalizado quando buyer_client_id não confere', () => {
    const context = resolveContractAccessContext(
      { id: 99, role: 'client', cpf: '22222222222' },
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
      { id: 40, role: 'broker', cpf: null },
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
      { id: 30, role: 'broker', cpf: null },
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
      seller_client_id: 20,
    };

    expect(
      resolveContractAccessContext({ id: 20, role: 'client', cpf: '22222222222' }, duplicatedContract)
        .userRole
    ).toBe('none');
    expect(
      resolveContractAccessContext({ id: 1, role: 'admin', cpf: null }, duplicatedContract)
        .userRole
    ).toBe('admin');
  });

  it('congela edição para participantes e responsável durante assinatura, sem congelar admin', () => {
    const frozenContract = { ...baseContract, status: 'AWAITING_SIGNATURES' };

    const responsible = resolveContractAccessContext(
      { id: 30, role: 'broker', cpf: null },
      frozenContract
    );
    const admin = resolveContractAccessContext(
      { id: 1, role: 'admin', cpf: null },
      frozenContract
    );

    expect(responsible.canEditSeller).toBe(false);
    expect(responsible.canEditBuyer).toBe(false);
    expect(admin.canEditSeller).toBe(true);
    expect(admin.canEditBuyer).toBe(true);
  });
});
