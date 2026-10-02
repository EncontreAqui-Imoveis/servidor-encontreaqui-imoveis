import { describe, expect, it, vi } from 'vitest';
import type { PoolConnection } from 'mysql2/promise';

import { reopenContractDocument } from './contractDocumentReopenService';
import type { ContractRow } from '../controllers/ContractController';

function txMock() {
  return { query: vi.fn() } as unknown as PoolConnection & { query: ReturnType<typeof vi.fn> };
}

const contract = {
  id: 'contract-1', negotiation_id: 'neg-1', status: 'AWAITING_DOCS', workflow_metadata: {},
  seller_approval_status: 'PENDING', buyer_approval_status: 'PENDING',
} as ContractRow;

function approvedDocument(status = 'APPROVED') {
  return {
    id: 19, document_type: 'doc_identidade', metadata_json: {
      contractId: 'contract-1', owner_side: 'seller', documentCategory: 'identidade',
      categoryStatus: status, uploadedBy: 7, auditTrail: [],
    },
  };
}

describe('reopenContractDocument', () => {
  it('bloqueia reabertura individual quando o lado já está aprovado', async () => {
    const tx = txMock();
    tx.query.mockResolvedValueOnce([[approvedDocument()], []]);

    await expect(reopenContractDocument(tx, {
      contractIdInput: 'contract-1', documentIdInput: 19, userIdInput: 99, userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue({ ...contract, seller_approval_status: 'APPROVED' }),
    })).rejects.toMatchObject({
      statusCode: 409,
      code: 'SIDE_ALREADY_APPROVED',
      message: 'Este lado já foi aprovado. Reinicie a análise antes de fazer alterações.',
    });
  });

  it.each(['APPROVED', 'APPROVED_WITH_RES'])('returns approved document %s to PENDING without changing the side or contract workflow', async (status) => {
    const tx = txMock();
    tx.query.mockResolvedValueOnce([[approvedDocument(status)], []]).mockResolvedValue([{}, []]);
    const result = await reopenContractDocument(tx, {
      contractIdInput: 'contract-1', documentIdInput: 19, userIdInput: 99, userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue(contract),
    });
    expect(result.changed).toBe(true);
    const metadata = String(tx.query.mock.calls[1][1][0]);
    expect(metadata).toContain('"categoryStatus":"PENDING"');
    expect(metadata).toContain('admin_document_reopened');
    expect(String(tx.query.mock.calls[2][0])).toContain('UPDATE contracts SET workflow_metadata');
    expect(String(tx.query.mock.calls[2][0])).not.toContain('seller_approval_status');
  });

  it('is idempotent for an already pending document and writes no audit event', async () => {
    const tx = txMock();
    tx.query.mockResolvedValueOnce([[approvedDocument('PENDING')], []]);
    const result = await reopenContractDocument(tx, {
      contractIdInput: 'contract-1', documentIdInput: 19, userIdInput: 99, userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue(contract),
    });
    expect(result.changed).toBe(false);
    expect(tx.query).toHaveBeenCalledTimes(1);
  });

  it('rejects a contract outside the documentation stage', async () => {
    const tx = txMock();
    await expect(reopenContractDocument(tx, {
      contractIdInput: 'contract-1', documentIdInput: 19, userIdInput: 99, userRoleInput: 'admin',
      loadContractForUpdate: vi.fn().mockResolvedValue({ ...contract, status: 'IN_DRAFT' }),
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(tx.query).not.toHaveBeenCalled();
  });
});
