import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryMock,
  getConnectionMock,
  txMock,
  readNegotiationDocumentObjectMock,
  deleteNegotiationDocumentObjectMock,
  saveNegotiationSignedProposalDocumentMock,
} = vi.hoisted(() => {
  const tx = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  return {
    queryMock: vi.fn(),
    getConnectionMock: vi.fn(),
    txMock: tx,
    readNegotiationDocumentObjectMock: vi.fn(),
    deleteNegotiationDocumentObjectMock: vi.fn(),
    saveNegotiationSignedProposalDocumentMock: vi.fn(),
  };
});

vi.mock('../../src/services/adminPersistenceService', () => ({
  adminDb: {
    query: queryMock,
    getConnection: getConnectionMock,
  },
}));

vi.mock('../../src/services/negotiationDocumentStorageService', () => ({
  readNegotiationDocumentObject: readNegotiationDocumentObjectMock,
  deleteNegotiationDocumentObject: deleteNegotiationDocumentObjectMock,
}));

vi.mock('../../src/services/negotiationPersistenceService', () => ({
  saveNegotiationSignedProposalDocument: saveNegotiationSignedProposalDocumentMock,
}));

import {
  deleteSignedProposal,
  downloadSignedProposal,
  listNegotiationResponsibles,
  updateNegotiationResponsibles,
  uploadSignedProposal,
} from '../../src/services/adminNegotiationDocumentService';

describe('adminNegotiationDocumentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionMock.mockResolvedValue(txMock);
    txMock.beginTransaction.mockResolvedValue(undefined);
    txMock.commit.mockResolvedValue(undefined);
    txMock.rollback.mockResolvedValue(undefined);
    txMock.release.mockResolvedValue(undefined);
    readNegotiationDocumentObjectMock.mockResolvedValue(Buffer.from('%PDF-1.4'));
    deleteNegotiationDocumentObjectMock.mockResolvedValue(undefined);
    saveNegotiationSignedProposalDocumentMock.mockResolvedValue(321);
  });

  it('lista responsáveis com fallback de schema quando a tabela não existe', async () => {
    queryMock.mockResolvedValueOnce([[]]);

    const result = await listNegotiationResponsibles('neg-1');

    expect(result).toMatchObject({
      negotiationId: 'neg-1',
      responsibles: [],
      schemaFallback: true,
    });
  });

  it('faz upload de proposta assinada e substitui documento anterior', async () => {
    txMock.query
      .mockResolvedValueOnce([[{ id: 'neg-1', status: 'PROPOSAL_SENT' }]])
      .mockResolvedValueOnce([
        [
          {
            id: 11,
            type: 'other',
            document_type: 'contrato_assinado',
            metadata_json: '{}',
            storage_provider: 'R2',
            storage_bucket: 'bucket',
            storage_key: 'key',
            storage_content_type: 'application/pdf',
            storage_size_bytes: 10,
            storage_etag: null,
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await uploadSignedProposal({
      negotiationId: 'neg-1',
      actorId: 7,
      file: {
        buffer: Buffer.from('%PDF-1.4'),
        mimetype: 'application/pdf',
        originalname: 'contrato_assinado.pdf',
      },
    });

    expect(result).toMatchObject({
      negotiationId: 'neg-1',
      documentId: 321,
      signedDocumentId: 321,
      signedDocumentFileName: 'contrato_assinado.pdf',
      hasSignedProposalDocument: true,
    });
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('negotiation_document_deletion_jobs'))).toBe(
      true
    );
    expect(deleteNegotiationDocumentObjectMock).not.toHaveBeenCalled();
  });

  it('baixa proposta assinada e monta filename', async () => {
    queryMock.mockResolvedValueOnce([
      [
        {
          id: 11,
          type: 'other',
          document_type: 'contrato_assinado',
          metadata_json: JSON.stringify({ originalFileName: 'minuta assinada.pdf' }),
          storage_provider: 'R2',
          storage_bucket: 'bucket',
          storage_key: 'key',
          storage_content_type: 'application/pdf',
          storage_size_bytes: 10,
          storage_etag: null,
        },
      ],
    ]);

    const result = await downloadSignedProposal('neg-1');

    expect(result.filename).toBe('minuta assinada.pdf');
    expect(result.fileContent).toEqual(Buffer.from('%PDF-1.4'));
  });

  it('remove proposta assinada existente', async () => {
    txMock.query
      .mockResolvedValueOnce([
        [
          {
            id: 'neg-1',
            status: 'DOCUMENTATION_PHASE',
          },
        ],
      ])
      .mockResolvedValueOnce([
        [
          {
            id: 11,
            type: 'other',
            document_type: 'contrato_assinado',
            metadata_json: '{}',
            storage_provider: 'R2',
            storage_bucket: 'bucket',
            storage_key: 'key',
            storage_content_type: 'application/pdf',
            storage_size_bytes: 10,
            storage_etag: null,
          },
        ],
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    const result = await deleteSignedProposal({
      negotiationId: 'neg-1',
      actorId: 7,
    });

    expect(result).toEqual({ negotiationId: 'neg-1', hasSignedProposalDocument: false });
    expect(txMock.query.mock.calls.some(([sql]) => String(sql).includes('negotiation_document_deletion_jobs'))).toBe(
      true
    );
    expect(deleteNegotiationDocumentObjectMock).not.toHaveBeenCalled();
    expect(
      txMock.query.mock.calls.some(
        ([sql]) => String(sql).includes('UPDATE negotiations') && String(sql).includes("PROPOSAL_SENT")
      )
    ).toBe(true);
  });
});
