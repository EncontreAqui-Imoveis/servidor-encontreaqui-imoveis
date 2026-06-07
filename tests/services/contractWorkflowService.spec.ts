import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getContractDbConnectionMock,
  txMock,
  deleteCloudinaryAssetMock,
  deleteNegotiationDocumentObjectMock,
} = vi.hoisted(() => {
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
    deleteCloudinaryAssetMock: vi.fn(),
    deleteNegotiationDocumentObjectMock: vi.fn(),
  };
});

vi.mock('../../src/services/contractPersistenceService', () => ({
  getContractDbConnection: getContractDbConnectionMock,
  queryContractRows: vi.fn(),
}));

vi.mock('../../src/config/cloudinary', () => ({
  deleteCloudinaryAsset: deleteCloudinaryAssetMock,
}));

vi.mock('../../src/services/negotiationDocumentStorageService', () => ({
  deleteNegotiationDocumentObject: deleteNegotiationDocumentObjectMock,
}));

import {
  isContractWorkflowError,
  transitionContractStatus,
} from '../../src/services/contractWorkflowService';

type MutableContractState = {
  id: string;
  negotiation_id: string;
  status: string;
  workflow_metadata: Record<string, unknown> | null;
  seller_approval_status: string;
  buyer_approval_status: string;
};

type MutableDocumentState = {
  id: number;
  negotiation_id: string;
  type: string;
  document_type: string;
  metadata_json: string | null;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
};

function createContractState(
  overrides: Partial<MutableContractState> = {}
): MutableContractState {
  return {
    id: 'contract-1',
    negotiation_id: 'neg-1',
    status: 'IN_DRAFT',
    workflow_metadata: {
      signatureMethod: 'online',
      signedContractUploadedOnlineAt: '2026-02-20T12:00:00.000Z',
      extra: 'keep-me',
    },
    seller_approval_status: 'APPROVED',
    buyer_approval_status: 'APPROVED',
    ...overrides,
  };
}

describe('contractWorkflowService', () => {
  let contractState: MutableContractState;
  let documentsState: MutableDocumentState[];
  let draftTotal: number;

  beforeEach(() => {
    vi.clearAllMocks();

    contractState = createContractState();
    documentsState = [];
    draftTotal = 0;

    getContractDbConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);

    txMock.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('draft_total')) {
        return [[
          {
            draft_total: draftTotal,
            signed_contract_total: 0,
            payment_receipt_total: 0,
            inspection_boleto_total: 0,
          },
        ]];
      }

      if (sql.includes('FROM negotiation_documents') && sql.includes('storage_provider')) {
        const negotiationId = String(params[0] ?? '');
        const requestedTypes = params.slice(1, -1).map((value) => String(value));
        const contractId = String(params[params.length - 1] ?? '');
        return [[
          ...documentsState.filter((item) => {
            if (item.negotiation_id !== negotiationId) return false;
            if (!requestedTypes.includes(String(item.document_type))) return false;
            const metadata = item.metadata_json ? JSON.parse(item.metadata_json) : {};
            const linkedContractId = String(metadata.contractId ?? '').trim();
            return linkedContractId === contractId || (!linkedContractId && item.document_type !== 'outro');
          }),
        ]];
      }

      if (sql.includes('UPDATE contracts') && sql.includes('SET status = ?, updated_at = CURRENT_TIMESTAMP')) {
        contractState.status = String(params[0] ?? contractState.status);
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE contracts') && sql.includes("seller_approval_status = 'PENDING'")) {
        contractState.seller_approval_status = 'PENDING';
        contractState.buyer_approval_status = 'PENDING';
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE contracts') && sql.includes('workflow_metadata = CAST(? AS JSON)')) {
        contractState.workflow_metadata = JSON.parse(String(params[0] ?? 'null'));
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('UPDATE contracts') && sql.includes('workflow_metadata = NULL')) {
        contractState.workflow_metadata = null;
        return [{ affectedRows: 1 }];
      }

      if (sql.includes('DELETE FROM negotiation_documents') && sql.includes('WHERE id IN')) {
        const ids = new Set(params.map((value) => Number(value)));
        documentsState = documentsState.filter((item) => !ids.has(item.id));
        return [{ affectedRows: ids.size }];
      }

      return [[]];
    });
  });

  it('rejects rollback from FINALIZED', async () => {
    contractState = createContractState({ status: 'FINALIZED' });

    await expect(
      transitionContractStatus({
        contractIdInput: 'contract-1',
        directionInput: 'previous',
        loadContractForUpdate: async () => contractState,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(deleteNegotiationDocumentObjectMock).not.toHaveBeenCalled();
    expect(deleteCloudinaryAssetMock).not.toHaveBeenCalled();
  });

  it('blocks moving to signatures without a valid draft', async () => {
    contractState = createContractState({ status: 'IN_DRAFT' });
    draftTotal = 0;

    await expect(
      transitionContractStatus({
        contractIdInput: 'contract-1',
        directionInput: 'next',
        loadContractForUpdate: async () => contractState,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
    });

    expect(txMock.commit).not.toHaveBeenCalled();
  });

  it('advances to AWAITING_SIGNATURES when the draft exists', async () => {
    contractState = createContractState({ status: 'IN_DRAFT' });
    draftTotal = 1;

    const result = await transitionContractStatus({
      contractIdInput: 'contract-1',
      directionInput: 'next',
      loadContractForUpdate: async () => contractState,
    });

    expect(result.message).toContain('AWAITING_SIGNATURES');
    expect(result.contract?.status).toBe('AWAITING_SIGNATURES');
    expect(contractState.status).toBe('AWAITING_SIGNATURES');
    expect(txMock.commit).toHaveBeenCalledTimes(1);
  });

  it('steps back and cleans documents when returning to IN_DRAFT', async () => {
    contractState = createContractState({ status: 'AWAITING_SIGNATURES' });
    documentsState = [
      {
        id: 11,
        negotiation_id: 'neg-1',
        type: 'contract',
        document_type: 'contrato_assinado',
        metadata_json: JSON.stringify({ contractId: 'contract-1' }),
        storage_provider: 'R2',
        storage_bucket: 'bucket-a',
        storage_key: 'contracts/contract-1/minuta.pdf',
      },
    ];

    const result = await transitionContractStatus({
      contractIdInput: 'contract-1',
      directionInput: 'previous',
      loadContractForUpdate: async () => contractState,
    });

    expect(result.contract?.status).toBe('IN_DRAFT');
    expect(contractState.status).toBe('IN_DRAFT');
    expect(contractState.workflow_metadata).toEqual({ extra: 'keep-me' });
    expect(deleteNegotiationDocumentObjectMock).toHaveBeenCalledTimes(1);
    expect(deleteCloudinaryAssetMock).not.toHaveBeenCalled();
    expect(documentsState).toHaveLength(0);
  });
});
