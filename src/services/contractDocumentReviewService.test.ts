import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import { reviewContractDocument } from './contractDocumentReviewService';
import type { ContractRow } from '../controllers/ContractController';

function createTxMock() {
  return {
    query: vi.fn(),
  } as unknown as PoolConnection & { query: ReturnType<typeof vi.fn> };
}

describe('reviewContractDocument', () => {
  it('persists approval metadata for an individual document', async () => {
    const tx = createTxMock();
    const contract = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
    } as ContractRow;

    tx.query
      .mockResolvedValueOnce([
        [
          {
            id: 11,
            type: 'other',
            document_type: 'doc_identidade',
            metadata_json: {
              contractId: 'contract-1',
              documentCategory: 'identidade',
              side: 'seller',
              auditTrail: [],
            },
            created_at: new Date('2026-07-09T10:00:00Z'),
          },
        ],
        [],
      ])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);

    const result = await reviewContractDocument(tx, {
      contractIdInput: 'contract-1',
      documentIdInput: '11',
      statusInput: 'APPROVED',
      reasonInput: '',
      userIdInput: 55,
      userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue(contract),
    });

    expect(result.message).toBe('Documento aprovado com sucesso.');
    expect(tx.query).toHaveBeenCalledTimes(3);
    const updateCall = tx.query.mock.calls[1];
    expect(String(updateCall[0])).toContain('UPDATE negotiation_documents');
    const serializedMetadata = String(updateCall[1][0]);
    expect(serializedMetadata).toContain('"categoryStatus":"APPROVED"');
    expect(serializedMetadata).toContain('"reviewStatus":"APPROVED"');
    expect(serializedMetadata).toContain('"reviewedBy":55');
  });

  it('requires a reason when rejecting a document', async () => {
    const tx = createTxMock();
    const contract = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
    } as ContractRow;

    await expect(
      reviewContractDocument(tx, {
        contractIdInput: 'contract-1',
        documentIdInput: '11',
        statusInput: 'REJECTED',
        reasonInput: '',
        userIdInput: 55,
        userRoleInput: 'admin',
        loadContractForUpdate: vi.fn().mockResolvedValue(contract),
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Informe um motivo com ao menos 3 caracteres para rejeitar.',
    });
  });
});
