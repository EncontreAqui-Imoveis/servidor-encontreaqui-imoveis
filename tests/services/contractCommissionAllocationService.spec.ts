import { describe, expect, it, vi } from 'vitest';

import {
  assertRentalCommissionPolicy,
  cancelContractCommissionAllocations,
  syncContractCommissionAllocations,
} from '../../src/services/contractCommissionAllocationService';

describe('contractCommissionAllocationService', () => {
  const rentalContract = {
    id: 'contract-rent-1',
    negotiation_id: 'neg-rent-1',
    deal_type: 'rent',
    property_purpose: 'Aluguel',
    capturing_broker_id: 10,
    selling_broker_id: 20,
  } as never;

  const rentalCommission = {
    valorBaseComissao: 2500,
    comissaoCaptador: 250,
    comissaoVendedor: 1250,
    taxaPlataforma: 1000,
  };

  it('accepts the one-time rental allocation split of 10/50/40', () => {
    expect(() => assertRentalCommissionPolicy(rentalContract, rentalCommission)).not.toThrow();
  });

  it('rejects a rental allocation that would create an invalid split', () => {
    expect(() =>
      assertRentalCommissionPolicy(rentalContract, {
        ...rentalCommission,
        comissaoCaptador: 500,
        taxaPlataforma: 750,
      }),
    ).toThrow('10% para o captador, 50% para o vendedor e 40% para a plataforma');
  });

  it('records one allocation per brokerage role and never a recurring cycle', async () => {
    const tx = { query: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) };

    await syncContractCommissionAllocations(tx as never, rentalContract, rentalCommission);

    expect(tx.query).toHaveBeenCalledTimes(3);
    expect(String(tx.query.mock.calls[1][0])).toContain('contract_commission_allocations');
    expect(tx.query.mock.calls[1][1]).toEqual([10, 'CAPTURING', 'rent', 2500, 250, 'contract-rent-1']);
    expect(tx.query.mock.calls[2][1]).toEqual([20, 'SELLING', 'rent', 2500, 1250, 'contract-rent-1']);
  });

  it('cancels recorded allocations when a finalized contract is reopened', async () => {
    const tx = { query: vi.fn().mockResolvedValue([{ affectedRows: 2 }]) };

    await cancelContractCommissionAllocations(tx as never, 'contract-rent-1');

    expect(String(tx.query.mock.calls[0][0])).toContain("status = 'CANCELLED'");
    expect(tx.query.mock.calls[0][1]).toEqual(['contract-rent-1']);
  });
});
