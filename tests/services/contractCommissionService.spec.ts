import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryContractRowsMock } = vi.hoisted(() => ({
  queryContractRowsMock: vi.fn(),
}));

vi.mock('../../src/services/contractPersistenceService', () => ({
  queryContractRows: queryContractRowsMock,
}));

import { listCommissionSummary } from '../../src/services/contractCommissionService';

describe('contractCommissionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aggregates finalized commissions for the requested month', async () => {
    queryContractRowsMock.mockResolvedValueOnce([
      {
        id: 'contract-1',
        negotiation_id: 'neg-1',
        property_id: 11,
        commission_data: {
          valorVenda: 100000,
          comissaoCaptador: 5000,
          comissaoVendedor: 2500,
          taxaPlataforma: 1000,
        },
        updated_at: '2026-06-10T12:00:00.000Z',
        property_title: 'Casa 1',
        property_code: 'ABC123',
        property_purpose: 'Venda',
        signed_proposal_document_id: 77,
      },
      {
        id: 'contract-2',
        negotiation_id: 'neg-2',
        property_id: 12,
        commission_data: '{"valorVenda":50000,"comissaoCaptador":2500,"comissaoVendedor":1250,"taxaPlataforma":500}',
        updated_at: '2026-06-11T12:00:00.000Z',
        property_title: 'Casa 2',
        property_code: 'DEF456',
        property_purpose: 'Aluguel',
        signed_proposal_document_id: null,
      },
    ]);

    const result = await listCommissionSummary(6, 2026);

    expect(queryContractRowsMock).toHaveBeenCalledTimes(1);
    expect(result.month).toBe(6);
    expect(result.year).toBe(2026);
    expect(result.summary).toMatchObject({
      totalVGV: 150000,
      totalCaptadores: 7500,
      totalVendedores: 3750,
      totalPlataforma: 1500,
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      contractId: 'contract-1',
      signedProposalDocumentSource: 'negotiation_documents',
      commissionData: {
        valorVenda: 100000,
        comissaoCaptador: 5000,
        comissaoVendedor: 2500,
        taxaPlataforma: 1000,
      },
    });
  });

  it('rejects invalid month input', async () => {
    await expect(listCommissionSummary(13, 2026)).rejects.toThrow('Mês inválido');
  });
});
