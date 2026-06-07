import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveContractStatusMock, txMock } = vi.hoisted(() => {
  const tx = {
    query: vi.fn(),
  };

  return {
    resolveContractStatusMock: vi.fn(),
    txMock: tx,
  };
});

vi.mock('../../src/controllers/ContractController', () => ({
  __esModule: true,
  resolveContractStatus: resolveContractStatusMock,
}));

import {
  deleteContractCommissionData,
  isContractCommissionMutationError,
  updateContractCommissionData,
} from '../../src/services/contractCommissionMutationService';

describe('contractCommissionMutationService', () => {
  const baseContract = {
    id: 'contract-1',
    negotiation_id: 'neg-1',
    status: 'FINALIZED',
    property_purpose: 'Venda',
    property_id: 101,
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveContractStatusMock.mockImplementation((status: string) => status);
  });

  it('updates commission data for finalized contracts with valid split', async () => {
    txMock.query
      .mockResolvedValueOnce([[baseContract]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ ...baseContract, commission_data: { valorVenda: 10000 } }]]);

    const result = await updateContractCommissionData(txMock as never, {
      req: {} as never,
      contractId: 'contract-1',
      body: {
        commissionData: {
          valorVenda: 10000,
          comissaoCaptador: 4000,
          comissaoVendedor: 3000,
          taxaPlataforma: 3000,
        },
      },
    });

    expect(result.contract?.id).toBe('contract-1');
    expect(result.commissionData).toEqual({
      valorVenda: 10000,
      comissaoCaptador: 4000,
      comissaoVendedor: 3000,
      taxaPlataforma: 3000,
    });
  });

  it('rejects non-finalized contracts', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          ...baseContract,
          status: 'AWAITING_DOCS',
        },
      ],
    ]);

    await expect(
      updateContractCommissionData(txMock as never, {
        req: {} as never,
        contractId: 'contract-1',
        body: {
          commissionData: {
            valorVenda: 10000,
            comissaoCaptador: 4000,
            comissaoVendedor: 3000,
            taxaPlataforma: 3000,
          },
        },
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Somente contratos finalizados podem alterar o VGV.',
    });
  });

  it('rejects inconsistent sales splits', async () => {
    txMock.query.mockResolvedValueOnce([[baseContract]]);

    await expect(
      updateContractCommissionData(txMock as never, {
        req: {} as never,
        contractId: 'contract-1',
        body: {
          commissionData: {
            valorVenda: 10000,
            comissaoCaptador: 5000,
            comissaoVendedor: 4000,
            taxaPlataforma: 1500,
          },
        },
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Dados financeiros inconsistentes: soma de comissões e taxa não pode exceder valorVenda.',
    });
  });

  it('deletes commission data for finalized contracts', async () => {
    txMock.query
      .mockResolvedValueOnce([[baseContract]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ ...baseContract, commission_data: null }]]);

    const result = await deleteContractCommissionData(txMock as never, {
      contractId: 'contract-1',
    });

    expect(result.contract?.commission_data).toBeNull();
  });

  it('returns a typed error when the contract does not exist', async () => {
    txMock.query.mockResolvedValueOnce([[]]);

    await expect(
      deleteContractCommissionData(txMock as never, {
        contractId: 'missing',
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      message: 'Contrato não encontrado.',
    });
  });

  it('exposes the service error guard', () => {
    const error = new Error('x');
    expect(isContractCommissionMutationError(error)).toBe(false);
  });
});
