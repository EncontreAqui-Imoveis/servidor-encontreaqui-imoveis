import { describe, expect, it } from 'vitest';
import {
  buildEditablePropertyState,
  buildPropertyEditDbPatch,
  preparePropertyEditPatch,
} from '../../src/services/propertyEditRequestService';

function createProperty(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Casa de teste',
    description: 'Descricao suficiente para a solicitacao de edicao.',
    type: 'Casa',
    purpose: 'Venda',
    market_stage: 'STANDARD',
    code: 'INTERNO-1',
    public_code: 'PUB-1',
    owner_name: 'Proprietario',
    owner_phone: '64999999999',
    address: 'Rua de teste',
    numero: '10',
    bairro: 'Centro',
    city: 'Rio Verde',
    state: 'GO',
    price: 100000,
    price_sale: 100000,
    price_rent: null,
    sem_quadra: 1,
    sem_lote: 1,
    sem_cep: 0,
    valor_condominio: null,
    ...overrides,
  };
}

describe('propertyEditRequestService', () => {
  it('persiste lançamento e ignora controles auxiliares sem alteração real', () => {
    const current = buildEditablePropertyState(createProperty());
    const result = preparePropertyEditPatch(
      {
        market_stage: 'LAUNCH',
        code: 'NAO-DEVE-ALTERAR',
        sem_lote: false,
        sem_quadra: false,
        valor_condominio: 0,
      },
      current,
    );

    expect(result.diff).toEqual({
      marketStage: { before: 'STANDARD', after: 'LAUNCH' },
    });
    expect(buildPropertyEditDbPatch(current, result.patch)).toEqual({
      market_stage: 'LAUNCH',
    });
  });

  it('recusa lançamento em imóvel exclusivo para aluguel', () => {
    const current = buildEditablePropertyState(
      createProperty({
        purpose: 'Aluguel',
        price: 2500,
        price_sale: null,
        price_rent: 2500,
      }),
    );

    expect(() => preparePropertyEditPatch({ market_stage: 'LAUNCH' }, current)).toThrow(
      'Lancamento esta disponivel apenas para imoveis de venda.',
    );
  });
});
