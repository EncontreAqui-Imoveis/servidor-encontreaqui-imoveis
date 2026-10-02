import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import { reviewContractDocument } from './contractDocumentReviewService';
import type { ContractRow } from '../controllers/ContractController';

const { enqueueDeletionMock, createUserNotificationMock } = vi.hoisted(() => ({
  enqueueDeletionMock: vi.fn(),
  createUserNotificationMock: vi.fn(),
}));

vi.mock('./negotiationDocumentDeletionService', () => ({
  enqueueNegotiationDocumentDeletion: enqueueDeletionMock,
}));

vi.mock('./notificationService', () => ({
  createUserNotification: createUserNotificationMock,
}));

function createTxMock() {
  return {
    query: vi.fn(),
  } as unknown as PoolConnection & { query: ReturnType<typeof vi.fn> };
}

describe('reviewContractDocument', () => {
  it('notifica somente o lado buyer, não o corretor que enviou o arquivo', async () => {
    const tx = createTxMock();
    const contract = {
      id: 'contract-uuid-interno',
      negotiation_id: 'neg-1',
      property_title: 'Apartamento Teste',
      advertiser_id: 10,
      property_owner_id: 11,
      proposer_id: 20,
      initiator_side: 'seller',
      legal_buyer_user_id: 30,
    } as ContractRow;
    createUserNotificationMock.mockResolvedValue(undefined);
    tx.query
      .mockResolvedValueOnce([[
        {
          id: 11,
          type: 'other',
          document_type: 'comprovante_renda',
          metadata_json: {
            contractId: 'contract-uuid-interno',
            documentCategory: 'comprovante_renda',
            owner_side: 'buyer',
            uploadedBy: 99,
            auditTrail: [],
          },
        },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);

    await reviewContractDocument(tx, {
      contractIdInput: contract.id,
      documentIdInput: '11',
      statusInput: 'APPROVED',
      reasonInput: '',
      userIdInput: 55,
      userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue(contract),
    });
    await Promise.resolve();

    expect(createUserNotificationMock).toHaveBeenCalledTimes(1);
    expect(createUserNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 30,
        title: 'Documento aprovado',
        message:
          'O documento Comprovante de Renda do contrato do imóvel Apartamento Teste foi aprovado.',
        metadata: expect.objectContaining({
          contractId: 'contract-uuid-interno',
          documentId: 11,
        }),
      })
    );
  });

  it('notifica somente participantes seller deduplicados e usa fallback humano do imóvel', async () => {
    const tx = createTxMock();
    const contract = {
      id: 'contract-uuid-interno',
      negotiation_id: 'neg-1',
      property_title: null,
      advertiser_id: 10,
      property_owner_id: 10,
      property_broker_id: 11,
      proposer_id: 20,
      initiator_side: 'seller',
      legal_buyer_user_id: 30,
    } as ContractRow;
    createUserNotificationMock.mockResolvedValue(undefined);
    tx.query
      .mockResolvedValueOnce([[
        {
          id: 12,
          type: 'other',
          document_type: 'seguro_incendio',
          metadata_json: {
            contractId: 'contract-uuid-interno',
            documentCategory: 'seguro_incendio',
            owner_side: 'seller',
            uploadedBy: 99,
            auditTrail: [],
          },
        },
      ], []])
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([{}, []])
      .mockResolvedValueOnce([{}, []]);

    await reviewContractDocument(tx, {
      contractIdInput: contract.id,
      documentIdInput: '12',
      statusInput: 'APPROVED',
      reasonInput: '',
      userIdInput: 55,
      userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue(contract),
    });
    await Promise.resolve();

    expect(createUserNotificationMock).toHaveBeenCalledTimes(3);
    expect(
      createUserNotificationMock.mock.calls.map(([input]) => input.recipientId)
    ).toEqual([10, 11, 20]);
    for (const [input] of createUserNotificationMock.mock.calls) {
      expect(input.message).toBe(
        'O documento Apólice/Comprovante de Seguro Incêndio do contrato do imóvel seu imóvel foi aprovado.'
      );
      expect(input.message).not.toContain(contract.id);
    }
  });

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
      .mockResolvedValueOnce([[], []])
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
    expect(tx.query).toHaveBeenCalledTimes(4);
    const updateCall = tx.query.mock.calls[2];
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

    expect(String(tx.query.mock.calls[1][0])).toContain('INSERT INTO contract_document_rejections');
    expect(
      tx.query.mock.calls.some(([sql]) => String(sql).includes('DELETE FROM negotiation_documents')),
    ).toBe(true);
    expect(enqueueDeletionMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 11, storage_key: 'contracts/identidade.pdf' }),
      expect.objectContaining({ requestSource: 'contract_document_rejected_by_admin' }),
    );
    expect(result.rejectedDocument).toMatchObject({
      id: 11,
      side: 'buyer',
      category: 'identidade',
      originalFileName: 'identidade.pdf',
      deletionJobId: 71,
    });
  });

  it('não aprova um pendente quando outra versão da mesma categoria já está aprovada', async () => {
    const tx = createTxMock();
    const contract = {
      id: 'contract-1',
      negotiation_id: 'neg-1',
    } as ContractRow;

    tx.query
      .mockResolvedValueOnce([[
        {
          id: 12,
          type: 'other',
          document_type: 'doc_identidade',
          metadata_json: {
            contractId: 'contract-1',
            documentCategory: 'identidade',
            owner_side: 'buyer',
            categoryStatus: 'PENDING',
          },
        },
      ], []])
      .mockResolvedValueOnce([[
        {
          id: 11,
          document_type: 'doc_identidade',
          metadata_json: {
            contractId: 'contract-1',
            documentCategory: 'identidade',
            owner_side: 'buyer',
            categoryStatus: 'APPROVED',
          },
        },
      ], []]);

    await expect(
      reviewContractDocument(tx, {
        contractIdInput: 'contract-1',
        documentIdInput: '12',
        statusInput: 'APPROVED',
        reasonInput: '',
        userIdInput: 55,
        userRoleInput: 'admin',
        loadContractForUpdate: vi.fn().mockResolvedValue(contract),
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DOCUMENT_ALREADY_APPROVED',
    });

    expect(tx.query).toHaveBeenCalledTimes(2);
    expect(
      tx.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE negotiation_documents'))
    ).toBe(false);
    expect(createUserNotificationMock).not.toHaveBeenCalled();
  });
});
