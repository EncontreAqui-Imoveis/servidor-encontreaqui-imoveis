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
  queryContractRows: vi.fn(),
}));

import { createContractFromApprovedNegotiation } from '../../src/services/contractCreationService';

describe('contractCreationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContractDbConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
  });

  it('creates a contract when negotiation is approved', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            property_id: 101,
            status: 'DOCUMENTATION_PHASE',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            client_name: 'Cliente Proponente',
            client_cpf: '12345678909',
            property_title: 'Casa Centro',
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([
        [
          {
            id: 'contract-1',
            negotiation_id: 'neg-1',
            property_id: 101,
            status: 'AWAITING_DOCS',
            seller_info: null,
            buyer_info: null,
            commission_data: null,
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: null,
            buyer_approval_reason: null,
            created_at: '2026-06-01 10:00:00',
            updated_at: '2026-06-01 10:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            seller_client_id: null,
            buyer_client_id: null,
            client_name: 'Cliente Proponente',
            client_cpf: '12345678909',
            property_title: 'Casa Centro',
            property_purpose: 'Venda',
            property_code: 'RV-101',
            property_image_url: null,
            property_owner_id: 1,
            property_owner_name: 'Owner',
            capturing_broker_name: null,
            selling_broker_name: null,
            seller_client_name: null,
            buyer_client_name: null,
            capturing_agency_name: null,
            capturing_agency_address: null,
            responsible_user_ids: null,
          },
        ],
      ]);

    const result = await createContractFromApprovedNegotiation('neg-1', null);

    expect(result.created).toBe(true);
    expect(result.contract.id).toBe('contract-1');
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('returns existing contract when already created', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            property_id: 101,
            status: 'DOCUMENTATION_PHASE',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            client_name: 'Cliente Proponente',
            client_cpf: '12345678909',
            property_title: 'Casa Centro',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 'contract-existing',
            negotiation_id: 'neg-1',
            property_id: 101,
            status: 'AWAITING_DOCS',
            seller_info: null,
            buyer_info: null,
            commission_data: null,
            seller_approval_status: 'PENDING',
            buyer_approval_status: 'PENDING',
            seller_approval_reason: null,
            buyer_approval_reason: null,
            created_at: '2026-06-01 10:00:00',
            updated_at: '2026-06-01 10:00:00',
            capturing_broker_id: 30003,
            selling_broker_id: 30004,
            seller_client_id: null,
            buyer_client_id: null,
            client_name: 'Cliente Proponente',
            client_cpf: '12345678909',
            property_title: 'Casa Centro',
            property_purpose: 'Venda',
            property_code: 'RV-101',
            property_image_url: null,
            property_owner_id: 1,
            property_owner_name: 'Owner',
            capturing_broker_name: null,
            selling_broker_name: null,
            seller_client_name: null,
            buyer_client_name: null,
            capturing_agency_name: null,
            capturing_agency_address: null,
            responsible_user_ids: null,
          },
        ],
      ]);

    const result = await createContractFromApprovedNegotiation('neg-1', null);

    expect(result.created).toBe(false);
    expect(result.contract.id).toBe('contract-existing');
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid negotiation id', async () => {
    await expect(createContractFromApprovedNegotiation('', null)).rejects.toThrow('ID da negociação inválido.');
  });

  it('rejects negotiation that is not approved enough', async () => {
    txMock.query.mockResolvedValueOnce([
      [
        {
          id: 'neg-1',
          property_id: 101,
          status: 'PENDING',
          capturing_broker_id: 30003,
          selling_broker_id: 30004,
          client_name: 'Cliente Proponente',
          client_cpf: '12345678909',
          property_title: 'Casa Centro',
        },
      ],
    ]);

    await expect(createContractFromApprovedNegotiation('neg-1', null)).rejects.toThrow(
      'A negociação precisa estar aprovada antes da criação do contrato.',
    );
  });

  it('rejects missing negotiation', async () => {
    txMock.query.mockResolvedValueOnce([[]]);

    await expect(createContractFromApprovedNegotiation('neg-x', null)).rejects.toThrow(
      'Negociação não encontrada.',
    );
  });
});
