import { describe, expect, it, vi } from 'vitest';

import {
  auditLegacyContracts,
  type LegacyContractAuditDb,
  type LegacyContractAuditTransaction,
} from '../../src/services/contractLegacyAuditService';

function createDatabaseMock(params: {
  auditRows: unknown[];
  transaction?: LegacyContractAuditTransaction;
}): LegacyContractAuditDb {
  return {
    query: vi
      .fn()
      .mockResolvedValueOnce([[{ table_exists: 1 }]])
      .mockResolvedValueOnce([params.auditRows]),
    getConnection: vi.fn().mockResolvedValue(params.transaction),
  };
}

describe('contractLegacyAuditService', () => {
  it('mapeia identidades duplas e nunca as torna elegiveis para backfill', async () => {
    const db = createDatabaseMock({
      auditRows: [
        {
          contract_id: 10,
          negotiation_id: 100,
          seller_client_id: 5,
          buyer_client_id: 5,
          seller_cpf: '529.982.247-25',
          buyer_cpf: '123.456.789-09',
          selling_broker_id: 20,
          responsible_count: 0,
          selling_broker_is_assignable: 1,
        },
        {
          contract_id: 11,
          negotiation_id: 101,
          seller_client_id: 6,
          buyer_client_id: 7,
          seller_cpf: '529.982.247-25',
          buyer_cpf: '52998224725',
          selling_broker_id: 21,
          responsible_count: 0,
          selling_broker_is_assignable: 1,
        },
        {
          contract_id: 12,
          negotiation_id: 102,
          seller_client_id: 8,
          buyer_client_id: 9,
          seller_cpf: '12345678901',
          buyer_cpf: '98765432100',
          selling_broker_id: 22,
          responsible_count: 0,
          selling_broker_is_assignable: 1,
        },
        {
          contract_id: 13,
          negotiation_id: 103,
          seller_client_id: 10,
          buyer_client_id: 11,
          seller_cpf: null,
          buyer_cpf: null,
          selling_broker_id: null,
          responsible_count: 0,
          selling_broker_is_assignable: 0,
        },
        {
          contract_id: 14,
          negotiation_id: 104,
          seller_client_id: 12,
          buyer_client_id: 13,
          seller_cpf: null,
          buyer_cpf: null,
          selling_broker_id: 23,
          responsible_count: 0,
          selling_broker_is_assignable: 0,
        },
      ],
    });

    const report = await auditLegacyContracts(db);

    expect(report.mode).toBe('audit');
    expect(report.dualParticipantIdentityContracts).toEqual([
      expect.objectContaining({ contractId: '10', sameUserId: true, sameCpf: false }),
      expect.objectContaining({ contractId: '11', sameUserId: false, sameCpf: true }),
    ]);
    expect(report.eligibleResponsibleBackfills).toEqual([
      { contractId: '12', negotiationId: '102', sellingBrokerId: '22' },
    ]);
    expect(report.manualReviewContracts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contractId: '13',
          reasons: ['MISSING_SELLING_BROKER'],
        }),
        expect.objectContaining({
          contractId: '14',
          reasons: ['INVALID_SELLING_BROKER'],
        }),
      ]),
    );
  });

  it('revalida o contrato em transacao antes de inserir o responsavel legado', async () => {
    const transaction: LegacyContractAuditTransaction = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
      query: vi
        .fn()
        .mockResolvedValueOnce([
          [
            {
              contract_id: 12,
              negotiation_id: 102,
              seller_client_id: 8,
              buyer_client_id: 9,
              seller_cpf: '12345678901',
              buyer_cpf: '98765432100',
              selling_broker_id: 22,
              selling_broker_is_assignable: 1,
            },
          ],
        ])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]),
    };
    const db = createDatabaseMock({
      transaction,
      auditRows: [
        {
          contract_id: 12,
          negotiation_id: 102,
          seller_client_id: 8,
          buyer_client_id: 9,
          seller_cpf: '12345678901',
          buyer_cpf: '98765432100',
          selling_broker_id: 22,
          responsible_count: 0,
          selling_broker_is_assignable: 1,
        },
      ],
    });

    const report = await auditLegacyContracts(db, { apply: true });

    expect(report.appliedResponsibleBackfills).toEqual([
      { contractId: '12', negotiationId: '102', sellingBrokerId: '22' },
    ]);
    expect(transaction.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO negotiation_responsibles'),
      [102, '22'],
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.release).toHaveBeenCalledTimes(1);
  });
});
