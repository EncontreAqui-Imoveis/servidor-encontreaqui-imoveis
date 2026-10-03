import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { ContractRow } from '../controllers/ContractController';
import {
  isContractDocumentCategoryStatus,
  type ContractDocumentCategoryStatus,
  type ContractDocumentCategoryCode,
} from '../modules/contracts/domain/contract.types';
import { enqueueNegotiationDocumentDeletion } from './negotiationDocumentDeletionService';
import { appendWorkflowAuditEvent } from './contractWorkflowMetadata';
import { createUserNotification } from './notificationService';
import {
  DOCUMENT_ALREADY_APPROVED_CODE,
  DOCUMENT_ALREADY_APPROVED_MESSAGE,
  findApprovedContractDocument,
} from './contractApprovedDocumentInvariant';
import {
  resolveDocumentCategoryFromType,
  type ContractDocumentSide,
} from '../modules/contracts/domain/contractDocumentValidation';
import type {
  ContractDocumentType,
} from '../modules/contracts/domain/contract.types';
import { resolveContractParticipantIdsForSide } from '../utils/contractAccessResolver';
import {
  resolveContractDocumentNotificationCategoryLabel,
  resolveContractDocumentNotificationPropertyTitle,
} from './contractDocumentNotificationSupport';
import {
  isContractSideApproved,
  SIDE_ALREADY_APPROVED_CODE,
  SIDE_ALREADY_APPROVED_MESSAGE,
} from './contractSideApprovalGuard';

type ContractDocumentRow = RowDataPacket & {
  id: number | string;
  type: string | null;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  created_at: string | Date | null;
};

type ContractAuditEvent = {
  action: string;
  at: string;
  by: number | null;
  role: string | null;
  details: Record<string, unknown>;
};

type ContractDocumentReviewInput = {
  contractIdInput: unknown;
  documentIdInput: unknown;
  statusInput: unknown;
  reasonInput: unknown;
  userIdInput: unknown;
  userRoleInput: unknown;
  loadContractForUpdate: (tx: PoolConnection, contractId: string) => Promise<ContractRow | null>;
};

type ContractDocumentReviewResult = {
  message: string;
  contract: ContractRow | null;
  rejectedDocument?: {
    id: number;
    documentType: string | null;
    side: ContractDocumentSide | null;
    category: ContractDocumentCategoryCode | null;
    originalFileName: string | null;
    deletionJobId: number | null;
  };
};

export type SideDocumentRejection = {
  id: number;
  documentType: string | null;
  category: ContractDocumentCategoryCode | null;
  originalFileName: string | null;
  deletionJobId: number | null;
};

class ContractDocumentReviewError extends Error {
  statusCode: number;
  code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function documentReviewError(
  statusCode: number,
  message: string,
  code?: string
): ContractDocumentReviewError {
  return new ContractDocumentReviewError(statusCode, message, code);
}

export function isContractDocumentReviewError(
  error: unknown
): error is ContractDocumentReviewError {
  return error instanceof ContractDocumentReviewError;
}

function parseStoredJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  if (typeof value !== 'string') {
    return {};
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

function appendAuditTrailEvent(
  source: unknown,
  event: ContractAuditEvent
): Record<string, unknown> {
  const metadata = parseStoredJsonObject(source);
  const current = Array.isArray(metadata.auditTrail) ? metadata.auditTrail : [];
  return {
    ...metadata,
    auditTrail: [...current, event],
  };
}

function resolveReviewStatus(value: unknown): ContractDocumentCategoryStatus | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'APPROVED_WITH_RES') return 'APPROVED_WITH_RES';
  if (normalized === 'APPROVED') return 'APPROVED';
  if (normalized === 'REJECTED') return 'REJECTED';
  if (normalized === 'PENDING') return 'PENDING';
  return isContractDocumentCategoryStatus(normalized)
    ? (normalized as ContractDocumentCategoryStatus)
    : null;
}

function normalizeReviewReason(reason: unknown): string {
  return String(reason ?? '').trim();
}

function readPositiveUserId(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readDocumentSide(metadata: Record<string, unknown>): ContractDocumentSide | null {
  const side = String(metadata.owner_side ?? metadata.side ?? '').trim().toLowerCase();
  return side === 'seller' || side === 'buyer' ? side : null;
}

function readDocumentCategory(
  metadata: Record<string, unknown>,
  documentType: string | null
): ContractDocumentCategoryCode | null {
  const category = String(
    metadata.documentCategory ?? metadata.document_category ?? ''
  ).trim().toLowerCase();
  if (category) return category as ContractDocumentCategoryCode;
  return resolveDocumentCategoryFromType(
    String(documentType ?? '').trim().toLowerCase() as ContractDocumentType
  );
}

function rejectionDetails(
  document: ContractDocumentRow,
  metadata: Record<string, unknown>
): {
  documentType: string | null;
  originalFileName: string | null;
  uploadedByUserId: number | null;
  ownerSide: ContractDocumentSide | null;
  documentCategory: ContractDocumentCategoryCode | null;
  documentLabel: string | null;
} {
  const documentType = String(document.document_type ?? '').trim().toLowerCase() || null;
  const rawOriginalFileName = String(
    metadata.originalFileName ?? metadata.original_file_name ?? metadata.fileName ?? metadata.file_name ?? metadata.name ?? ''
  ).trim();
  let originalFileName: string | null = rawOriginalFileName || null;
  if (!originalFileName && document.storage_key) {
    const cleanName = (String(document.storage_key).split('/').pop() ?? '').replace(/^\d+[-_]/, '');
    originalFileName = cleanName || null;
  }
  const ownerSide = readDocumentSide(metadata);
  return {
    documentType,
    originalFileName,
    uploadedByUserId: readPositiveUserId(metadata.uploadedBy),
    ownerSide,
    documentCategory: readDocumentCategory(metadata, document.document_type),
    documentLabel: String(metadata.label ?? metadata.documentLabel ?? '').trim() || null,
  };
}

/**
 * Persists the same rejection history and deferred storage cleanup used by an
 * individual review, without emitting per-document notifications.
 */
export async function rejectActiveContractDocumentsForSide(
  tx: PoolConnection,
  params: {
    contract: ContractRow;
    contractId: string;
    side: ContractDocumentSide;
    reason: string;
    actorId: number | null;
  }
): Promise<SideDocumentRejection[]> {
  const [rows] = await tx.query<ContractDocumentRow[]>(
    `
      SELECT id, type, document_type, metadata_json, storage_provider, storage_bucket, storage_key, created_at
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
        AND COALESCE(
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.owner_side')),
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.side'))
        ) = ?
        AND COALESCE(document_type, '') <> 'proposal'
      FOR UPDATE
    `,
    [params.contract.negotiation_id, params.contractId, params.side]
  );
  const now = new Date().toISOString();
  const rejections: SideDocumentRejection[] = [];
  for (const document of rows) {
    const metadata = parseStoredJsonObject(document.metadata_json);
    if (resolveReviewStatus(metadata.categoryStatus ?? metadata.reviewStatus ?? metadata.status) === 'REJECTED') {
      continue;
    }
    const details = rejectionDetails(document, metadata);
    await tx.query(
      `
        INSERT INTO contract_document_rejections (
          contract_id, negotiation_id, source_document_id, document_type, document_label,
          original_file_name, owner_side, reason, uploaded_by_user_id, rejected_by_admin_id, rejected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        params.contractId, params.contract.negotiation_id, document.id,
        details.documentType, details.documentLabel, details.originalFileName, details.ownerSide,
        params.reason, details.uploadedByUserId, params.actorId, now,
      ]
    );
    await tx.query(
      'DELETE FROM negotiation_documents WHERE id = ? AND negotiation_id = ? LIMIT 1',
      [document.id, params.contract.negotiation_id]
    );
    const deletionJobId = await enqueueNegotiationDocumentDeletion(tx, document, {
      negotiationId: params.contract.negotiation_id,
      requestedByUserId: params.actorId,
      requestSource: 'contract_side_documents_rejected',
    });
    rejections.push({
      id: Number(document.id), documentType: details.documentType, category: details.documentCategory,
      originalFileName: details.originalFileName, deletionJobId,
    });
  }
  return rejections;
}

export async function reviewContractDocument(
  tx: PoolConnection,
  params: ContractDocumentReviewInput
): Promise<ContractDocumentReviewResult> {
  const contractId = String(params.contractIdInput ?? '').trim();
  if (!contractId) {
    throw documentReviewError(400, 'ID do contrato inválido.');
  }

  const documentId = Number(params.documentIdInput);
  if (!Number.isFinite(documentId) || documentId <= 0) {
    throw documentReviewError(400, 'ID do documento inválido.');
  }

  const status = resolveReviewStatus(params.statusInput);
  if (!status || (status !== 'APPROVED' && status !== 'APPROVED_WITH_RES' && status !== 'REJECTED' && status !== 'PENDING')) {
    throw documentReviewError(400, 'Status de revisão inválido.');
  }

  const reason = normalizeReviewReason(params.reasonInput);
  if (status === 'REJECTED' && reason.length < 3) {
    throw documentReviewError(400, 'Informe um motivo com ao menos 3 caracteres para rejeitar.');
  }

  const contract = await params.loadContractForUpdate(tx, contractId);
  if (!contract) {
    throw documentReviewError(404, 'Contrato não encontrado.');
  }

  const [documentRows] = await tx.query<ContractDocumentRow[]>(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key,
        created_at
      FROM negotiation_documents
      WHERE id = ? AND negotiation_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [documentId, contract.negotiation_id]
  );

  const document = documentRows[0];
  if (!document) {
    throw documentReviewError(404, 'Documento não encontrado para este contrato.');
  }

  const metadata = parseStoredJsonObject(document.metadata_json);
  const documentSide = readDocumentSide(metadata);
  if (documentSide && isContractSideApproved(contract, documentSide)) {
    throw documentReviewError(
      409,
      SIDE_ALREADY_APPROVED_MESSAGE,
      SIDE_ALREADY_APPROVED_CODE
    );
  }
  const now = new Date().toISOString();
  const userId = Number(params.userIdInput ?? 0);
  const actorId = Number.isFinite(userId) && userId > 0 ? userId : null;
  const role = String(params.userRoleInput ?? '').trim().toLowerCase() || null;

  const normalizedReason = reason.length > 0 ? reason : null;
  const documentType = String(document.document_type ?? '').trim().toLowerCase() || null;
  const rawOriginalFileName = String(
    metadata.originalFileName ??
      metadata.original_file_name ??
      metadata.fileName ??
      metadata.file_name ??
      metadata.name ??
      ''
  ).trim();

  let originalFileName: string | null = rawOriginalFileName || null;
  if (!originalFileName && document.storage_key) {
    const baseName = String(document.storage_key).split('/').pop() ?? '';
    const cleanName = baseName.replace(/^\d+[-_]/, '');
    if (cleanName.length > 0) {
      originalFileName = cleanName;
    }
  }

  const uploadedByUserId = readPositiveUserId(metadata.uploadedBy);
  const ownerSideValue = String(metadata.owner_side ?? metadata.side ?? '').trim().toLowerCase();
  const ownerSide = ownerSideValue === 'seller' || ownerSideValue === 'buyer' ? ownerSideValue : null;
  const documentCategory = readDocumentCategory(metadata, document.document_type);
  const documentLabel = String(metadata.label ?? metadata.documentLabel ?? '').trim() || null;

  if (status === 'APPROVED' || status === 'APPROVED_WITH_RES') {
    const side = readDocumentSide(metadata);
    const category = readDocumentCategory(metadata, document.document_type);
    if (side && category && documentType) {
      const approvedDocumentId = await findApprovedContractDocument(tx, {
        contractId,
        negotiationId: contract.negotiation_id,
        side,
        category,
        documentType,
        excludeDocumentId: documentId,
      });
      if (approvedDocumentId !== null) {
        throw documentReviewError(
          409,
          DOCUMENT_ALREADY_APPROVED_MESSAGE,
          DOCUMENT_ALREADY_APPROVED_CODE
        );
      }
    }
  }

  if (status === 'REJECTED') {
    const workflowMetadata = appendWorkflowAuditEvent(contract.workflow_metadata, {
      action: 'admin_document_rejected_and_removed',
      at: now,
      by: actorId,
      role,
      details: {
        documentId,
        documentType,
        originalFileName,
        reason: normalizedReason,
        uploadedByUserId,
      },
    });

    await tx.query(
      `
        INSERT INTO contract_document_rejections (
          contract_id,
          negotiation_id,
          source_document_id,
          document_type,
          document_label,
          original_file_name,
          owner_side,
          reason,
          uploaded_by_user_id,
          rejected_by_admin_id,
          rejected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        contractId,
        contract.negotiation_id,
        documentId,
        documentType,
        documentLabel,
        originalFileName,
        ownerSide,
        normalizedReason ?? 'Documento rejeitado sem justificativa registrada.',
        uploadedByUserId,
        actorId,
        now,
      ]
    );

    await tx.query(
      `
        DELETE FROM negotiation_documents
        WHERE id = ? AND negotiation_id = ?
        LIMIT 1
      `,
      [documentId, contract.negotiation_id]
    );
    const deletionJobId = await enqueueNegotiationDocumentDeletion(tx, document, {
      negotiationId: contract.negotiation_id,
      requestedByUserId: actorId,
      requestSource: 'contract_document_rejected_by_admin',
    });
    await tx.query(
      `
        UPDATE contracts
        SET workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [JSON.stringify(workflowMetadata), contractId]
    );

    return {
      message: 'Documento rejeitado e removido. Solicite um novo envio.',
      contract,
      rejectedDocument: {
        id: documentId,
        documentType,
        side: ownerSide,
        category: documentCategory,
        originalFileName,
        deletionJobId,
      },
    };
  }

  const nextMetadata = appendAuditTrailEvent(metadata, {
    action: 'admin_document_review',
    at: now,
    by: actorId,
    role,
    details: {
      documentId,
      documentType,
      status,
      reason: normalizedReason,
    },
  });

  nextMetadata.status = status;
  nextMetadata.reviewStatus = status;
  nextMetadata.validationStatus = status;
  nextMetadata.categoryStatus = status;
  nextMetadata.reviewReason = normalizedReason;
  nextMetadata.reviewedAt = now;
  nextMetadata.reviewedBy = actorId;
  nextMetadata.reviewedByRole = role;

  await tx.query(
    `
      UPDATE negotiation_documents
      SET metadata_json = CAST(? AS JSON)
      WHERE id = ?
        AND negotiation_id = ?
      LIMIT 1
    `,
    [JSON.stringify(nextMetadata), documentId, contract.negotiation_id]
  );

  await tx.query(
    `
      UPDATE contracts
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [contractId]
  );

  if (status === 'APPROVED' || status === 'APPROVED_WITH_RES') {
    const recipientIds = ownerSide
      ? resolveContractParticipantIdsForSide(contract, ownerSide)
      : [];
    const categoryLabel = resolveContractDocumentNotificationCategoryLabel(
      documentCategory
    );
    const propertyTitle = resolveContractDocumentNotificationPropertyTitle(contract);

    for (const recipientId of recipientIds) {
      void createUserNotification({
        type: 'negotiation',
        title: 'Documento aprovado',
        message: `O documento ${categoryLabel} do contrato do imóvel ${propertyTitle} foi aprovado.`,
        recipientId,
        relatedEntityId: Number(contract.negotiation_id) || null,
        target: 'contract_details',
        metadata: {
          contractId,
          negotiationId: contract.negotiation_id,
          documentId,
          documentType,
        },
      }).catch((err) => {
        console.error('Falha ao enviar notificacao de documento aprovado:', err);
      });
    }
  }

  return {
    message:
      status === 'PENDING'
          ? 'Revisão do documento reiniciada com sucesso.'
          : 'Documento aprovado com sucesso.',
    contract,
  };
}
