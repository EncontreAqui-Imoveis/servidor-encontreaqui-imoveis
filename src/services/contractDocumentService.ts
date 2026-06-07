import JSZip from 'jszip';

import type { AuthRequest } from '../middlewares/auth';
import { queryContractRows } from './contractPersistenceService';
import {
  buildContractDocumentProgress,
  buildContractDocumentRuleContextFromRow,
  mapContract,
  mapDocument,
  type ContractDocumentRow,
  type ContractRow,
} from '../controllers/ContractController';
import { readNegotiationDocumentObject } from './negotiationDocumentStorageService';

type ContractDocumentListItem = ReturnType<typeof mapDocument> & {
  downloadUrl: string;
};

type ContractDocumentStorageItem = ContractDocumentRow & {
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
} & ReturnType<typeof mapDocument> & {
    downloadUrl: string;
  };

type ContractDocumentPayload = {
  contract: ReturnType<typeof mapContract> & {
    documentProgress: ReturnType<typeof buildContractDocumentProgress>;
  };
  documents: ContractDocumentListItem[];
};

type DownloadedContractDocumentsZip = {
  fileNameBase: string;
  fileBuffer: Buffer;
};

function canViewOwnerSensitiveData(req: AuthRequest | null, row: ContractRow): boolean {
  if (!req) return false;
  const role = String(req.userRole ?? '').trim().toLowerCase();
  if (role === 'admin') {
    return true;
  }
  const userId = Number(req.userId ?? 0);
  return Number.isFinite(userId) && userId > 0 && userId === Number(row.capturing_broker_id ?? 0);
}

function shouldExposeOwnerSensitiveDocument(
  input: {
    side: ReturnType<typeof mapDocument>['side'];
    documentCategory: ReturnType<typeof mapDocument>['documentCategory'];
  },
  canViewSensitiveData: boolean
): boolean {
  if (canViewSensitiveData) return true;
  return !(input.side === 'seller' && input.documentCategory === 'dados_bancarios');
}

function isProposalDocument(document: {
  document_type?: string | null;
  type?: string | null;
  documentType?: string | null;
}): boolean {
  const normalizedDocumentType = String(
    document.document_type ?? document.documentType ?? ''
  )
    .trim()
    .toLowerCase();
  const normalizedType = String(document.type ?? '').trim().toLowerCase();
  return normalizedDocumentType === 'proposal' || normalizedType === 'proposal';
}

async function fetchVisibleContractDocuments(
  contract: Pick<ContractRow, 'negotiation_id' | 'id'>,
  req: AuthRequest | null
): Promise<ContractDocumentListItem[]> {
  const documents = await queryContractRows<ContractDocumentRow>(
    `
      SELECT id, type, document_type, metadata_json, created_at
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
      ORDER BY created_at DESC, id DESC
    `,
    [contract.negotiation_id]
  );

  const canViewSensitiveData = canViewOwnerSensitiveData(req, contract as ContractRow);
  return documents
    .filter((document) => !isProposalDocument(document))
    .map((document) => ({
      ...mapDocument(document),
      downloadUrl: `/negotiations/${contract.negotiation_id}/documents/${document.id}/download`,
    }))
    .filter((document) =>
      shouldExposeOwnerSensitiveDocument(
        {
          side: document.side,
          documentCategory: document.documentCategory,
        },
        canViewSensitiveData
      )
    );
}

async function fetchVisibleContractDocumentsWithStorage(
  contract: Pick<ContractRow, 'negotiation_id' | 'id'>,
  req: AuthRequest | null
): Promise<ContractDocumentStorageItem[]> {
  const documents = await queryContractRows<
    ContractDocumentRow & {
      storage_provider: string | null;
      storage_bucket: string | null;
      storage_key: string | null;
      storage_content_type: string | null;
      storage_size_bytes: number | null;
      storage_etag: string | null;
    }
  >(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        created_at,
        storage_provider,
        storage_bucket,
        storage_key,
        storage_content_type,
        storage_size_bytes,
        storage_etag
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
      ORDER BY created_at DESC, id DESC
    `,
    [contract.negotiation_id]
  );

  const canViewSensitiveData = canViewOwnerSensitiveData(req, contract as ContractRow);
  return documents
    .filter((document) => !isProposalDocument(document))
    .map((document) => ({
      ...document,
      ...mapDocument(document),
      downloadUrl: `/negotiations/${contract.negotiation_id}/documents/${document.id}/download`,
    }))
    .filter((document) =>
      shouldExposeOwnerSensitiveDocument(
        {
          side: document.side,
          documentCategory: document.documentCategory,
        },
        canViewSensitiveData
      )
    );
}

export async function buildContractDocumentPayload(
  contract: ContractRow,
  req: AuthRequest | null = null
): Promise<ContractDocumentPayload> {
  const documents = await fetchVisibleContractDocuments(contract, req);
  const matrixContext = buildContractDocumentRuleContextFromRow(contract);

  return {
    contract: {
      ...mapContract(contract, req),
      documentProgress: buildContractDocumentProgress(
        documents.map((document) => ({
          ...document,
          metadata: document.metadata as Record<string, unknown>,
        })),
        matrixContext
      ),
    },
    documents,
  };
}

export async function buildContractDocumentsZip(
  contract: ContractRow,
  req: AuthRequest | null = null
): Promise<DownloadedContractDocumentsZip | null> {
  const visibleDocuments = await fetchVisibleContractDocumentsWithStorage(contract, req);
  if (visibleDocuments.length === 0) {
    return null;
  }

  const zip = new JSZip();
  for (const document of visibleDocuments) {
    const fallbackName =
      document.originalFileName ??
      `${String(document.documentType ?? 'documento').trim() || 'documento'}_${document.id}.bin`;
    zip.file(
      fallbackName,
      await readNegotiationDocumentObject({
        storage_provider: document.storage_provider,
        storage_bucket: document.storage_bucket,
        storage_key: document.storage_key,
      })
    );
  }

  const fileNameBase =
    String(contract.property_code ?? '').trim() ||
    `contrato_${contract.id}`;
  const fileBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  return { fileNameBase, fileBuffer };
}
