import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { ContractRow } from '../controllers/ContractController';
import {
  isContractDocumentCategoryStatus,
  type ContractDocumentCategoryStatus,
} from '../modules/contracts/domain/contract.types';
import { enqueueNegotiationDocumentDeletion } from './negotiationDocumentDeletionService';
import { appendWorkflowAuditEvent } from './contractWorkflowMetadata';
import { createUserNotification } from './notificationService';

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
    originalFileName: string | null;
    uploadedByUserId: number | null;
    deletionJobId: number | null;
  };
};

class ContractDocumentReviewError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function documentReviewError(statusCode: number, message: string): ContractDocumentReviewError {
  return new ContractDocumentReviewError(statusCode, message);
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
  const now = new Date().toISOString();
  const userId = Number(params.userIdInput ?? 0);
  const actorId = Number.isFinite(userId) && userId > 0 ? userId : null;
  const role = String(params.userRoleInput ?? '').trim().toLowerCase() || null;

  const normalizedReason = reason.length > 0 ? reason : null;
  const documentType = String(document.document_type ?? '').trim().toLowerCase() || null;
  const originalFileName = String(metadata.originalFileName ?? '').trim() || null;
  const uploadedByUserId = readPositiveUserId(metadata.uploadedBy);

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
        originalFileName,
        uploadedByUserId,
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
    const docName = String(metadata.label ?? metadata.originalFileName ?? documentType ?? 'Documento').trim();
    const recipientIds = new Set<number>();
    if (uploadedByUserId && uploadedByUserId > 0) {
      recipientIds.add(uploadedByUserId);
    } else {
      if (contract.buyer_client_id) recipientIds.add(Number(contract.buyer_client_id));
      if (contract.owner_id) recipientIds.add(Number(contract.owner_id));
    }

    for (const recipientId of recipientIds) {
      void createUserNotification({
        type: 'negotiation',
        title: 'Documento Aprovado',
        message: `O seu documento "${docName}" do contrato #${contractId} foi analisado e aprovado com sucesso.`,
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
