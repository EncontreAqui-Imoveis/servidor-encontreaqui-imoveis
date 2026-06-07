import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { storeNegotiationDocumentToR2 } from './negotiationDocumentStorageService';
import {
  isContractDocumentType,
  type ContractDocumentCategoryCode,
} from '../modules/contracts/domain/contract.types';
import { resolveFallbackDocumentTypeByCategory } from '../modules/contracts/domain/contractDocumentValidation';
import { resolveContractStatus, type ContractRow } from '../controllers/ContractController';

interface UploadFinalizedDocumentBody {
  documentType?: unknown;
  document_type?: unknown;
  documentCategory?: unknown;
  document_category?: unknown;
  side?: unknown;
}

interface FinalizedDocumentAssetRow extends RowDataPacket {
  id: number;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
}

class ContractFinalizedDocumentMutationError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mutationError(statusCode: number, message: string): ContractFinalizedDocumentMutationError {
  return new ContractFinalizedDocumentMutationError(statusCode, message);
}

function normalizeDocumentCategory(
  value: unknown
): ContractDocumentCategoryCode | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  const allowed = new Set<ContractDocumentCategoryCode>([
    'identidade',
    'comprovante_endereco',
    'estado_civil',
    'conjuge_documentos',
    'comprovante_renda',
    'dados_bancarios',
    'docs_imovel',
    'outro',
  ]);
  return allowed.has(normalized as ContractDocumentCategoryCode)
    ? (normalized as ContractDocumentCategoryCode)
    : null;
}

function parseDocumentSide(value: unknown): 'seller' | 'buyer' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'seller' || normalized === 'buyer') {
    return normalized;
  }
  return null;
}

function documentTypeRequiresSide(documentType: string): boolean {
  const normalized = documentType.trim().toLowerCase();
  return (
    normalized !== 'contrato_minuta' &&
    normalized !== 'contrato_assinado' &&
    normalized !== 'comprovante_pagamento' &&
    normalized !== 'boleto_vistoria' &&
    normalized !== 'outro'
  );
}

function resolveDocumentStorageType(documentType: string): 'contract' | 'other' {
  if (documentType === 'contrato_minuta' || documentType === 'contrato_assinado') {
    return 'contract';
  }
  return 'other';
}

function parseStoredJsonObject(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function buildContractDocumentDeleteWhereClause(): string {
  return `
    negotiation_id = ?
    AND (
      JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
      OR JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
    )
    AND COALESCE(document_type, '') <> 'proposal'
    AND COALESCE(type, '') <> 'proposal'
  `;
}

export async function uploadFinalizedContractDocument(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contract: ContractRow;
    contractId: string;
    body: UploadFinalizedDocumentBody;
    uploadedFile: Express.Multer.File;
  }
): Promise<{
  document: {
    id: number;
    contractId: string;
    documentType: string;
    side: 'seller' | 'buyer' | null;
    originalFileName: string | null;
    downloadUrl: string;
  };
}> {
  const documentCategoryInput = normalizeDocumentCategory(
    params.body.documentCategory ?? params.body.document_category
  );
  const documentTypeRaw = String(
    params.body.documentType ?? params.body.document_type ?? ''
  ).trim();
  const normalizedDocumentType = (
    documentTypeRaw ||
    (documentCategoryInput
      ? resolveFallbackDocumentTypeByCategory(documentCategoryInput)
      : '')
  ).toLowerCase();

  if (!isContractDocumentType(normalizedDocumentType)) {
    throw mutationError(400, 'Tipo de documento inválido.');
  }

  const requestedSide = parseDocumentSide(params.body.side);
  if (documentTypeRequiresSide(normalizedDocumentType) && requestedSide == null) {
    throw mutationError(400, 'Informe o lado do documento (seller ou buyer) para este tipo.');
  }

  if (!params.uploadedFile?.buffer || params.uploadedFile.buffer.length === 0) {
    throw mutationError(400, 'Arquivo obrigatório para upload.');
  }

  if (resolveContractStatus(params.contract.status) !== 'FINALIZED') {
    throw mutationError(400, 'Somente contratos finalizados podem receber documentos nesta área.');
  }

  const documentId = await storeNegotiationDocumentToR2({
    executor: tx,
    negotiationId: params.contract.negotiation_id,
    type: resolveDocumentStorageType(normalizedDocumentType),
    documentType: normalizedDocumentType,
    content: params.uploadedFile.buffer,
    metadataJson: {
      contractId: params.contractId,
      side: requestedSide,
      originalFileName: params.uploadedFile.originalname ?? null,
      uploadedBy: Number(params.req.userId ?? 0) || null,
      uploadedAt: new Date().toISOString(),
      uploadedVia: 'admin-finalized',
    },
  });

  await tx.query(
    `
      UPDATE contracts
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [params.contractId]
  );

  return {
    document: {
      id: documentId,
      contractId: params.contractId,
      documentType: normalizedDocumentType,
      side: requestedSide,
      originalFileName: params.uploadedFile.originalname ?? null,
      downloadUrl: `/negotiations/${params.contract.negotiation_id}/documents/${documentId}/download`,
    },
  };
}

export async function deleteFinalizedContractDocument(
  tx: PoolConnection,
  params: {
    contract: Pick<ContractRow, 'id' | 'negotiation_id' | 'status'>;
    contractId: string;
    documentId: number;
  }
): Promise<{ document: FinalizedDocumentAssetRow }> {
  if (resolveContractStatus(params.contract.status) !== 'FINALIZED') {
    throw mutationError(400, 'Somente contratos finalizados podem remover documentos nesta área.');
  }

  const [documentRows] = await tx.query<FinalizedDocumentAssetRow[]>(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key,
        storage_content_type,
        storage_size_bytes,
        storage_etag
      FROM negotiation_documents
      WHERE id = ?
        AND ${buildContractDocumentDeleteWhereClause()}
      LIMIT 1
      FOR UPDATE
    `,
    [params.documentId, params.contract.negotiation_id, params.contract.id]
  );

  const document = documentRows[0];
  if (!document) {
    throw mutationError(404, 'Documento não encontrado para este contrato.');
  }

  await tx.query(
    `
      DELETE FROM negotiation_documents
      WHERE id = ? AND ${buildContractDocumentDeleteWhereClause()}
      LIMIT 1
    `,
    [params.documentId, params.contract.negotiation_id, params.contract.id]
  );

  await tx.query(
    `
      UPDATE contracts
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [params.contractId]
  );

  return { document };
}

export function isContractFinalizedDocumentMutationError(
  error: unknown
): error is ContractFinalizedDocumentMutationError {
  return error instanceof ContractFinalizedDocumentMutationError;
}

export type { FinalizedDocumentAssetRow };
