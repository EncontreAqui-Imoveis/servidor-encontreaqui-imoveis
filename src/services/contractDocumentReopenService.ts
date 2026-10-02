import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { ContractRow } from '../controllers/ContractController';
import { appendWorkflowAuditEvent } from './contractWorkflowMetadata';
import {
  resolveDocumentCategoryFromType,
  type ContractDocumentSide,
} from '../modules/contracts/domain/contractDocumentValidation';
import type {
  ContractDocumentCategoryCode,
  ContractDocumentType,
} from '../modules/contracts/domain/contract.types';
import {
  isContractSideApproved,
  SIDE_ALREADY_APPROVED_CODE,
  SIDE_ALREADY_APPROVED_MESSAGE,
} from './contractSideApprovalGuard';

type DocumentRow = RowDataPacket & {
  id: number | string;
  document_type: string | null;
  metadata_json: unknown;
};

type ReopenInput = {
  contractIdInput: unknown;
  documentIdInput: unknown;
  userIdInput: unknown;
  userRoleInput: unknown;
  loadContractForUpdate: (tx: PoolConnection, contractId: string) => Promise<ContractRow | null>;
};

export type ReopenContractDocumentResult = {
  message: string;
  contract: ContractRow;
  changed: boolean;
  document?: { id: number; side: ContractDocumentSide; category: ContractDocumentCategoryCode };
};

class ContractDocumentReopenError extends Error {
  constructor(readonly statusCode: number, message: string, readonly code?: string) {
    super(message);
  }
}

export function isContractDocumentReopenError(error: unknown): error is ContractDocumentReopenError {
  return error instanceof ContractDocumentReopenError;
}

function reopenError(statusCode: number, message: string, code?: string): ContractDocumentReopenError {
  return new ContractDocumentReopenError(statusCode, message, code);
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...(value as Record<string, unknown>) };
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : {};
  } catch {
    return {};
  }
}

function appendDocumentAudit(metadata: Record<string, unknown>, event: Record<string, unknown>): Record<string, unknown> {
  const trail = Array.isArray(metadata.auditTrail) ? metadata.auditTrail : [];
  return { ...metadata, auditTrail: [...trail, event] };
}

function approvedStatus(metadata: Record<string, unknown>): string {
  return String(metadata.categoryStatus ?? metadata.reviewStatus ?? metadata.validationStatus ?? metadata.status ?? '')
    .trim()
    .toUpperCase();
}

function documentSide(metadata: Record<string, unknown>): ContractDocumentSide | null {
  const side = String(metadata.owner_side ?? metadata.side ?? '').trim().toLowerCase();
  return side === 'seller' || side === 'buyer' ? side : null;
}

function documentCategory(metadata: Record<string, unknown>, documentType: string | null): ContractDocumentCategoryCode | null {
  const category = String(metadata.documentCategory ?? metadata.document_category ?? '').trim().toLowerCase();
  if (category) return category as ContractDocumentCategoryCode;
  return resolveDocumentCategoryFromType(String(documentType ?? '').trim().toLowerCase() as ContractDocumentType);
}

export async function reopenContractDocument(
  tx: PoolConnection,
  input: ReopenInput
): Promise<ReopenContractDocumentResult> {
  const contractId = String(input.contractIdInput ?? '').trim();
  const documentId = Number(input.documentIdInput);
  if (!contractId) throw reopenError(400, 'ID do contrato inválido.');
  if (!Number.isInteger(documentId) || documentId <= 0) throw reopenError(400, 'ID do documento inválido.');

  const contract = await input.loadContractForUpdate(tx, contractId);
  if (!contract) throw reopenError(404, 'Contrato não encontrado.');
  if (String(contract.status ?? '').trim().toUpperCase() !== 'AWAITING_DOCS') {
    throw reopenError(409, 'A reabertura de análise só é permitida em AWAITING_DOCS.');
  }

  const [rows] = await tx.query<DocumentRow[]>(
    `SELECT id, document_type, metadata_json FROM negotiation_documents WHERE id = ? AND negotiation_id = ? LIMIT 1 FOR UPDATE`,
    [documentId, contract.negotiation_id]
  );
  const document = rows[0];
  if (!document) throw reopenError(404, 'Documento não encontrado para este contrato.');

  const metadata = parseMetadata(document.metadata_json);
  const side = documentSide(metadata);
  const category = documentCategory(metadata, document.document_type);
  if (!side || !category) throw reopenError(409, 'O documento não possui categoria e lado válidos para reabertura.');

  if (isContractSideApproved(contract, side)) {
    throw reopenError(409, SIDE_ALREADY_APPROVED_MESSAGE, SIDE_ALREADY_APPROVED_CODE);
  }

  const currentStatus = approvedStatus(metadata);
  if (currentStatus === 'PENDING') {
    return { message: 'A análise deste documento já está aberta.', contract, changed: false };
  }
  if (currentStatus !== 'APPROVED' && currentStatus !== 'APPROVED_WITH_RES') {
    throw reopenError(409, 'Somente documentos aprovados podem ter a análise reaberta.');
  }

  const now = new Date().toISOString();
  const actorId = Number(input.userIdInput ?? 0);
  const actor = Number.isInteger(actorId) && actorId > 0 ? actorId : null;
  const role = String(input.userRoleInput ?? '').trim().toLowerCase() || null;
  const auditEvent = {
    action: 'admin_document_reopened', at: now, by: actor, role,
    details: { documentId, side, category, previousStatus: currentStatus, status: 'PENDING' },
  };
  const nextMetadata = appendDocumentAudit(metadata, auditEvent);
  nextMetadata.status = 'PENDING';
  nextMetadata.reviewStatus = 'PENDING';
  nextMetadata.validationStatus = 'PENDING';
  nextMetadata.categoryStatus = 'PENDING';
  nextMetadata.reviewReason = null;
  nextMetadata.reviewedAt = now;
  nextMetadata.reviewedBy = actor;
  nextMetadata.reviewedByRole = role;
  nextMetadata.validationResult = { isValid: true, status: 'PENDING', issues: [] };

  await tx.query(`UPDATE negotiation_documents SET metadata_json = CAST(? AS JSON) WHERE id = ? AND negotiation_id = ?`, [JSON.stringify(nextMetadata), documentId, contract.negotiation_id]);
  const workflowMetadata = appendWorkflowAuditEvent(contract.workflow_metadata, auditEvent);
  await tx.query(`UPDATE contracts SET workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(workflowMetadata), contractId]);

  return {
    message: 'Análise do documento reaberta com sucesso.',
    contract,
    changed: true,
    document: { id: documentId, side, category },
  };
}
