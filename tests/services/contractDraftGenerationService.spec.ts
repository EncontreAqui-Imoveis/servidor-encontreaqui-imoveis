import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getContractDbConnectionMock, txMock } = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    getContractDbConnectionMock: vi.fn(),
    txMock: tx,
  };
});

vi.mock('../../src/services/contractPersistenceService', () => ({
  getContractDbConnection: getContractDbConnectionMock,
}));

import {
  ensureContractDraftGenerated,
  isContractDraftGenerationError,
} from '../../src/services/contractDraftGenerationService';

describe('ensureContractDraftGenerated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContractDbConnectionMock.mockResolvedValue(txMock);
  });

  it.each(['AWAITING_SIGNATURES', 'FINALIZED'])(
    'never regenerates a draft when the contract is %s',
    async (status) => {
      txMock.query.mockResolvedValueOnce([
        [
          {
            id: 'contract-1',
            negotiation_id: 'negotiation-1',
            deal_type: 'sale',
            status,
            seller_info: {},
            buyer_info: {},
            workflow_metadata: {},
            payment_details: {},
            property_title: 'Imovel',
            address: null,
            numero: null,
            bairro: null,
            city: null,
            state: null,
          },
        ],
      ]);

      await expect(
        ensureContractDraftGenerated('contract-1', { forceRegenerate: true })
      ).rejects.toSatisfy((error: unknown) =>
        isContractDraftGenerationError(error) && error.statusCode === 409
      );

      expect(txMock.query).toHaveBeenCalledTimes(1);
      expect(txMock.commit).not.toHaveBeenCalled();
      expect(txMock.rollback).toHaveBeenCalledTimes(1);
      expect(txMock.release).toHaveBeenCalledTimes(1);
    }
  );
});
