import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import {
  resolveDocumentCategoryFromType,
  type ContractDocumentSide,
} from '../modules/contracts/domain/contractDocumentValidation';
import type {
  ContractDocumentCategoryCode,
  ContractDocumentType,
} from '../modules/contracts/domain/contract.types';

export const DOCUMENT_ALREADY_APPROVED_CODE = 'DOCUMENT_ALREADY_APPROVED';
export const DOCUMENT_ALREADY_APPROVED_MESSAGE =
  'Este documento já foi aprovado. Para substituí-lo, é necessário reabrir a análise.';

type ApprovedDocumentRow = RowDataPacket & {
  id: number | string;
  document_type: string | null;
  metadata_json: unknown;
};

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function readSide(metadata: Record<string, unknown>): ContractDocumentSide | null {
  const value = String(metadata.owner_side ?? metadata.side ?? '').trim().toLowerCase();
  return value === 'seller' || value === 'buyer' ? value : null;
}

function readCategory(
  metadata: Record<string, unknown>,
  documentType: string | null
): ContractDocumentCategoryCode | null {
  const storedCategory = String(
    metadata.documentCategory ?? metadata.document_category ?? ''
  ).trim().toLowerCase();
  if (storedCategory) {
    return storedCategory as ContractDocumentCategoryCode;
  }

  return resolveDocumentCategoryFromType(
    String(documentType ?? '').trim().toLowerCase() as ContractDocumentType
  );
}

function isApproved(metadata: Record<string, unknown>): boolean {
  const status = String(
    metadata.categoryStatus ??
      metadata.reviewStatus ??
      metadata.validationStatus ??
      metadata.status ??
      ''
  ).trim().toUpperCase();
  return status === 'APPROVED' || status === 'APPROVED_WITH_RES';
}

function isPending(metadata: Record<string, unknown>): boolean {
  const status = String(
    metadata.categoryStatus ??
      metadata.reviewStatus ??
      metadata.validationStatus ??
      metadata.status ??
      ''
  ).trim().toUpperCase();
  return status === 'PENDING';
}

function hasSameDocumentIdentity(
  document: ApprovedDocumentRow,
  metadata: Record<string, unknown>,
  target: {
    side: ContractDocumentSide;
    category: ContractDocumentCategoryCode | null;
    documentType: string;
  }
): boolean {
  if (readSide(metadata) !== target.side) return false;

  const documentType = String(document.document_type ?? '').trim().toLowerCase();
  const targetDocumentType = target.documentType.trim().toLowerCase();
  const category = readCategory(metadata, document.document_type);

  // "Outro" deliberately has independently addressable numbered slots. For
  // every other category, an approved accepted type closes the category.
  if (target.category === 'outro') {
    return category === 'outro' && documentType === targetDocumentType;
  }

  return target.category
    ? category === target.category
    : documentType === targetDocumentType;
}

export async function findApprovedContractDocument(
  tx: PoolConnection,
  params: {
    contractId: string;
    negotiationId: string | number;
    side: ContractDocumentSide;
    category: ContractDocumentCategoryCode | null;
    documentType: string;
    excludeDocumentId?: number;
  }
): Promise<number | null> {
  const [rows] = await tx.query<ApprovedDocumentRow[]>(
    `
      SELECT id, document_type, metadata_json
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
          OR JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
        )
        AND (
          ? IS NULL
          OR id <> ?
        )
        AND UPPER(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.categoryStatus')),
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
            ''
          )
        ) IN ('APPROVED', 'APPROVED_WITH_RES')
      FOR UPDATE
    `,
    [
      params.negotiationId,
      params.contractId,
      params.excludeDocumentId ?? null,
      params.excludeDocumentId ?? null,
    ]
  );

  const approvedDocument = rows.find((document) => {
    if (
      params.excludeDocumentId !== undefined &&
      Number(document.id) === params.excludeDocumentId
    ) {
      return false;
    }
    const metadata = parseMetadata(document.metadata_json);
    return isApproved(metadata) && hasSameDocumentIdentity(document, metadata, params);
  });

  return approvedDocument ? Number(approvedDocument.id) : null;
}

export async function findPendingContractDocument(
  tx: PoolConnection,
  params: {
    contractId: string;
    negotiationId: string | number;
    side: ContractDocumentSide;
    category: ContractDocumentCategoryCode | null;
    documentType: string;
  }
): Promise<number | null> {
  const [rows] = await tx.query<ApprovedDocumentRow[]>(
    `
      SELECT id, document_type, metadata_json
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
          OR JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
        )
        AND UPPER(
          COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.categoryStatus')),
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
            JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
            ''
          )
        ) = 'PENDING'
      FOR UPDATE
    `,
    [params.negotiationId, params.contractId]
  );

  const pendingDocument = rows.find((document) => {
    const metadata = parseMetadata(document.metadata_json);
    return isPending(metadata) && hasSameDocumentIdentity(document, metadata, params);
  });

  return pendingDocument ? Number(pendingDocument.id) : null;
}
