import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import { reviewContractDocument } from './contractDocumentReviewService';
import type { ContractRow } from '../controllers/ContractController';

const { enqueueDeletionMock } = vi.hoisted(() => ({ enqueueDeletionMock: vi.fn() }));

vi.mock('./negotiationDocumentDeletionService', () => ({
  enqueueNegotiationDocumentDeletion: enqueueDeletionMock,
}));

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

  it('removes a rejected document, queues physical deletion and retains the audit in the contract', async () => {
    const tx = createTxMock();
    const contract = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
      workflow_metadata: {},
    } as ContractRow;
    enqueueDeletionMock.mockResolvedValueOnce(71);
    tx.query
      .mockResolvedValueOnce([[
        {
          id: 11,
          type: 'other',
          document_type: 'doc_identidade',
          metadata_json: {
            contractId: 'contract-1',
            documentCategory: 'identidade',
            owner_side: 'buyer',
            originalFileName: 'identidade.pdf',
            uploadedBy: 42,
          },
          storage_provider: 'R2',
          storage_bucket: 'documents',
          storage_key: 'contracts/identidade.pdf',
          created_at: new Date('2026-07-14T10:00:00Z'),
        },
      ], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);

    const result = await reviewContractDocument(tx, {
      contractIdInput: 'contract-1',
      documentIdInput: '11',
      statusInput: 'REJECTED',
      reasonInput: 'Imagem ilegível',
      userIdInput: 55,
      userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue(contract),
    });

    expect(String(tx.query.mock.calls[1][0])).toContain('DELETE FROM negotiation_documents');
    expect(enqueueDeletionMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 11, storage_key: 'contracts/identidade.pdf' }),
      expect.objectContaining({ requestSource: 'contract_document_rejected_by_admin' }),
    );
    expect(result.rejectedDocument).toMatchObject({
      id: 11,
      originalFileName: 'identidade.pdf',
      uploadedByUserId: 42,
      deletionJobId: 71,
    });
  });
});
