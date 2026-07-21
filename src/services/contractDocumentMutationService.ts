import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { storeNegotiationDocumentToR2 } from './negotiationDocumentStorageService';
import { enqueueNegotiationDocumentDeletion } from './negotiationDocumentDeletionService';
import {
  buildContractDocumentRuleContextFromRow,
  type ContractRow,
  resolveContractStatus,
} from '../controllers/ContractController';
import {
  appendWorkflowAuditEvent,
  mergeWorkflowMetadata,
} from './contractWorkflowMetadata';
import { resolveContractAccessContext } from '../utils/contractAccessResolver';
import {
  resolveDocumentCategoryFromType,
  resolveFallbackDocumentTypeByCategory,
  validateContractDocumentUpload,
  type ContractDocumentSide,
} from '../modules/contracts/domain/contractDocumentValidation';
import { isUploadBlockedForNotApplicableCategory } from '../modules/contracts/domain/contractDocumentRuleMatrix';
import {
  assertParticipantMutationAllowed,
  isContractWorkflowGuardError,
} from './contractWorkflowGuard';
import type {
  ContractDocumentCategoryCode,
  ContractDocumentType,
} from '../modules/contracts/domain/contract.types';

interface ContractDocumentRow extends RowDataPacket {
  id: number;
  type: string;
  document_type: string | null;
  metadata_json: unknown;
  created_at: Date | string | null;
}

interface UploadContractDocumentBody {
  documentType?: unknown;
  document_type?: unknown;
  documentCategory?: unknown;
  document_category?: unknown;
  side?: unknown;
}

interface ContractAuditEvent {
  action: string;
  at: string;
  by: number | null;
  role: string | null;
  details?: Record<string, unknown>;
}

interface DeleteContractDocumentResult {
  document: ContractDocumentForDeleteRow;
}

class ContractDocumentMutationError extends Error {
  statusCode: number;
  body?: Record<string, unknown>;

  constructor(statusCode: number, message: string, body?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.body = body;
  }
}

function mutationError(
  statusCode: number,
  message: string,
  body?: Record<string, unknown>
): ContractDocumentMutationError {
  return new ContractDocumentMutationError(statusCode, message, body);
}

interface ContractDocumentForDeleteRow extends ContractDocumentRow {
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
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

function normalizeContractDocumentCategory(
  value: unknown
): ContractDocumentCategoryCode | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  const allowed = new Set<ContractDocumentCategoryCode>([
    'identidade',
    'comprovante_endereco',
    'estado_civil',
    'conjuge_documentos',
    'comprovante_renda',
    'seguro_incendio',
    'dados_bancarios',
    'certidao_inteiro_teor_escritura',
    'certidao_onus_acoes',
    'outro',
  ]);
  return allowed.has(normalized as ContractDocumentCategoryCode)
    ? (normalized as ContractDocumentCategoryCode)
    : null;
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

function parseDocumentSide(value: unknown): ContractDocumentSide | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'seller' || normalized === 'buyer') {
    return normalized;
  }
  return null;
}

function readDocumentOwnerSide(
  metadata: Record<string, unknown>
): ContractDocumentSide | null {
  // owner_side is immutable source of truth; side only supports legacy rows.
  return parseDocumentSide(metadata.owner_side ?? metadata.side);
}

function isSignedDocumentType(value: string): boolean {
  return (
    value === 'contrato_assinado' ||
    value === 'comprovante_pagamento' ||
    value === 'boleto_vistoria'
  );
}

function isAdminSupplementalDocumentType(value: string): boolean {
  return value === 'outro';
}

function resolveDocumentStorageType(documentType: string): 'contract' | 'other' {
  if (documentType === 'contrato_minuta' || documentType === 'contrato_assinado') {
    return 'contract';
  }
  return 'other';
}

async function persistContractWorkflowMetadata(
  tx: PoolConnection,
  contractId: string,
  workflowMetadata: Record<string, unknown>
): Promise<void> {
  await tx.query(
    `
      UPDATE contracts
      SET
        workflow_metadata = CAST(? AS JSON),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [JSON.stringify(workflowMetadata), contractId]
  );
}

export async function uploadContractDocument(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contract: ContractRow;
    contractId: string;
    body: UploadContractDocumentBody;
    uploadedFile: Express.Multer.File;
  }
): Promise<{
  document: {
    id: number | null;
    documentType: string;
    documentCategory: ContractDocumentCategoryCode | null;
    side: ContractDocumentSide | null;
    ownerSide: ContractDocumentSide;
    originalFileName: string | null;
    contractId: string;
  };
}> {
  const documentCategoryInput = normalizeContractDocumentCategory(
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
  if (!normalizedDocumentType) {
    throw mutationError(400, 'Tipo de documento inválido.');
  }

  const requestedSide = parseDocumentSide(params.body.side);
  const context = resolveContractAccessContext(
    { id: params.req.userId, role: params.req.userRole },
    params.contract
  );
  params.req.contractContext = context;
  if (context.userRole === 'none') {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }
  try {
    assertParticipantMutationAllowed(params.contract, context, 'document_upload');
  } catch (error) {
    if (isContractWorkflowGuardError(error)) {
      throw mutationError(error.statusCode, error.message, { code: error.code });
    }
    throw error;
  }
  const role = context.userRole;
  const resolvedSide: ContractDocumentSide | null = requestedSide;
  if (!resolvedSide) {
    throw mutationError(
      400,
      'Informe o dono do documento (side: seller|buyer).'
    );
  }

  if (resolvedSide === 'seller' && !context.canEditSeller) {
    throw mutationError(403, 'Seu acesso não permite anexar documentos do lado vendedor nesta etapa.');
  }

  if (resolvedSide === 'buyer' && !context.canEditBuyer) {
    throw mutationError(403, 'Seu acesso não permite anexar documentos do lado comprador nesta etapa.');
  }

  const isSupplementalOther = normalizedDocumentType === 'outro';
  const isAdminSupplemental =
    role === 'admin' && isAdminSupplementalDocumentType(normalizedDocumentType);
  const currentStatus = resolveContractStatus(params.contract.status);
  const bypassesWorkflowStage = role === 'admin';

  if (!bypassesWorkflowStage && (isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental)) {
    if (currentStatus !== 'AWAITING_SIGNATURES') {
      throw mutationError(
        400,
        'Documentos assinados, comprovantes e anexos complementares só podem ser enviados em AWAITING_SIGNATURES.'
      );
    }
  }

  const resolvedDocumentCategory =
    documentCategoryInput ??
    resolveDocumentCategoryFromType(normalizedDocumentType as ContractDocumentType);
  if (
    !bypassesWorkflowStage &&
    !isSignedDocumentType(normalizedDocumentType) &&
    !isAdminSupplemental
  ) {
    if (currentStatus !== 'AWAITING_DOCS') {
      throw mutationError(
        400,
        'Categorias documentais só podem ser enviadas na etapa de documentação.'
      );
    }
    if (!resolvedDocumentCategory) {
      throw mutationError(
        400,
        'documentCategory é obrigatório para documentos da etapa AWAITING_DOCS.'
      );
    }
  }

  if (
    resolvedDocumentCategory &&
    resolvedSide &&
    !isSignedDocumentType(normalizedDocumentType) &&
    !isAdminSupplemental
  ) {
    const notApplicable = isUploadBlockedForNotApplicableCategory(
      resolvedSide,
      resolvedDocumentCategory,
      buildContractDocumentRuleContextFromRow(params.contract)
    );
    if (notApplicable.blocked && !isSupplementalOther) {
      throw mutationError(422, 'Categoria documental não se aplica a este contrato ou lado.', {
        code: 'CATEGORY_NOT_APPLICABLE',
        reasonCode: notApplicable.reasonCode,
        validationResult: {
          isValid: false,
          status: 'REJECTED',
          issues: [
            {
              code: 'CATEGORY_NOT_APPLICABLE',
              field: 'documentCategory',
              message: 'Esta categoria não é exigida para a finalidade e perfil atuais.',
            },
          ],
        },
      });
    }
  }

  const uploadValidation = validateContractDocumentUpload({
    file: {
      mimetype: params.uploadedFile.mimetype ?? '',
      originalname: params.uploadedFile.originalname ?? '',
      size: Number(params.uploadedFile.size ?? params.uploadedFile.buffer.length ?? 0),
    },
    documentType: normalizedDocumentType as ContractDocumentType,
    category: resolvedDocumentCategory,
    side: resolvedSide,
    requiresSide: true,
    requiresCategory:
      !isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental,
  });
  if (!uploadValidation.isValid) {
    throw mutationError(422, 'Documento inválido para a categoria informada.', {
      validationResult: uploadValidation,
    });
  }

  const uploadEvent: ContractAuditEvent = {
    action:
      role === 'admin' && currentStatus !== 'AWAITING_DOCS'
        ? 'admin_read_only_bypass_document_upload'
        : 'document_upload',
    at: new Date().toISOString(),
    by: Number(params.req.userId ?? 0) || null,
    role: role || null,
    details: {
      side: resolvedSide,
      documentType: normalizedDocumentType,
      category: resolvedDocumentCategory,
    },
  };

  const metadataWithAudit = appendAuditTrailEvent({}, uploadEvent);
  metadataWithAudit.contractId = params.contractId;
  metadataWithAudit.owner_side = resolvedSide;
  // Keep the old response key while clients migrate to owner_side.
  metadataWithAudit.side = resolvedSide;
  metadataWithAudit.documentCategory = resolvedDocumentCategory;
  metadataWithAudit.categoryStatus =
    isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental
      ? 'APPROVED'
      : 'PENDING';
  metadataWithAudit.validationResult = uploadValidation;
  metadataWithAudit.originalFileName = params.uploadedFile.originalname ?? null;
  metadataWithAudit.contentType = params.uploadedFile.mimetype ?? null;
  metadataWithAudit.uploadedBy = Number(params.req.userId ?? 0) || null;
  metadataWithAudit.uploadedAt = uploadEvent.at;

  const documentId = await storeNegotiationDocumentToR2({
    executor: tx,
    negotiationId: params.contract.negotiation_id,
    type: resolveDocumentStorageType(normalizedDocumentType),
    documentType: normalizedDocumentType,
    content: params.uploadedFile.buffer,
    contentType: params.uploadedFile.mimetype,
    metadataJson: metadataWithAudit,
  });

  const shouldMarkOnlineSignatureMethod =
    role !== 'admin' && normalizedDocumentType === 'contrato_assinado';
  const nextWorkflowMetadata = appendWorkflowAuditEvent(
    params.contract.workflow_metadata,
    uploadEvent
  );

  if (shouldMarkOnlineSignatureMethod) {
    const signatureAwareWorkflowMetadata = mergeWorkflowMetadata(nextWorkflowMetadata, {
      signatureMethod: 'online',
      signedContractUploadedOnlineAt: uploadEvent.at,
      signedContractUploadedOnlineBy: Number(params.req.userId ?? 0) || null,
    });
    await persistContractWorkflowMetadata(tx, params.contractId, signatureAwareWorkflowMetadata);
  } else {
    await persistContractWorkflowMetadata(tx, params.contractId, nextWorkflowMetadata);
  }

  return {
    document: {
      id: documentId > 0 ? documentId : null,
      documentType: documentTypeRaw || normalizedDocumentType,
      documentCategory: resolvedDocumentCategory,
      side: resolvedSide,
      ownerSide: resolvedSide,
      originalFileName: params.uploadedFile.originalname ?? null,
      contractId: params.contractId,
    },
  };
}

export async function deleteContractDocument(
  tx: PoolConnection,
  params: {
    req: AuthRequest;
    contract: ContractRow;
    contractId: string;
    documentId: number;
  }
): Promise<DeleteContractDocumentResult> {
  const [documentRows] = await tx.query<ContractDocumentForDeleteRow[]>(
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
      WHERE id = ? AND negotiation_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [params.documentId, params.contract.negotiation_id]
  );

  const document = documentRows[0];
  if (!document) {
    throw mutationError(404, 'Documento não encontrado.');
  }

  const metadata = parseStoredJsonObject(document.metadata_json);
  const side = readDocumentOwnerSide(metadata);
  const documentType = String(document.document_type ?? '').trim().toLowerCase();
  const context = resolveContractAccessContext(
    { id: params.req.userId, role: params.req.userRole },
    params.contract
  );
  params.req.contractContext = context;
  if (context.userRole === 'none') {
    throw mutationError(403, 'Acesso negado ao contrato.');
  }
  try {
    assertParticipantMutationAllowed(params.contract, context, 'document_delete');
  } catch (error) {
    if (isContractWorkflowGuardError(error)) {
      throw mutationError(error.statusCode, error.message, { code: error.code });
    }
    throw error;
  }
  if (!side) {
    throw mutationError(409, 'Documento legado sem dono explícito. Corrija-o pelo painel administrativo.');
  }
  if (side === 'seller' && !context.canEditSeller) {
    throw mutationError(403, 'Seu acesso não permite remover documentos do lado vendedor nesta etapa.');
  }
  if (side === 'buyer' && !context.canEditBuyer) {
    throw mutationError(403, 'Seu acesso não permite remover documentos do lado comprador nesta etapa.');
  }

  await tx.query(
    `
      DELETE FROM negotiation_documents
      WHERE id = ? AND negotiation_id = ?
      LIMIT 1
    `,
    [params.documentId, params.contract.negotiation_id]
  );

  await enqueueNegotiationDocumentDeletion(tx, document, {
    negotiationId: params.contract.negotiation_id,
    requestSource: 'contract_document_delete',
  });

  const status = resolveContractStatus(params.contract.status);
  const workflowMetadata =
    context.userRole === 'admin' && status !== 'AWAITING_DOCS'
      ? appendWorkflowAuditEvent(params.contract.workflow_metadata, {
          action: 'admin_read_only_bypass_document_delete',
          at: new Date().toISOString(),
          by: Number(params.req.userId ?? 0) || null,
          role: 'admin',
          details: { side, documentType, status },
        })
      : null;

  await tx.query(
    `
      UPDATE contracts
      SET
        workflow_metadata = CASE
          WHEN ? IS NULL THEN workflow_metadata
          ELSE CAST(? AS JSON)
        END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      workflowMetadata ? JSON.stringify(workflowMetadata) : null,
      workflowMetadata ? JSON.stringify(workflowMetadata) : null,
      params.contractId,
    ]
  );

  return { document };
}

export function isContractDocumentMutationError(
  error: unknown
): error is ContractDocumentMutationError {
  return error instanceof ContractDocumentMutationError;
}
