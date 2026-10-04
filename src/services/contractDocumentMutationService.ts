import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import {
  isInvalidNegotiationDocumentContentError,
  storeNegotiationDocumentToR2,
} from './negotiationDocumentStorageService';
import { enqueueNegotiationDocumentDeletion } from './negotiationDocumentDeletionService';
import {
  buildContractDocumentRuleContextFromRow,
  type ContractRow,
  resolveContractStatus,
} from '../controllers/ContractController';
import {
  appendWorkflowAuditEvent,
  clearAwaitingDocumentResubmission,
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
import {
  DOCUMENT_ALREADY_APPROVED_CODE,
  DOCUMENT_ALREADY_APPROVED_MESSAGE,
  findApprovedContractDocument,
  findPendingContractDocument,
} from './contractApprovedDocumentInvariant';
import {
  isContractSideApproved,
  SIDE_ALREADY_APPROVED_CODE,
  SIDE_ALREADY_APPROVED_MESSAGE,
} from './contractSideApprovalGuard';
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
  replaceDocumentId?: unknown;
  replace_document_id?: unknown;
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

interface ReplacedContractDocumentRow extends ContractDocumentForDeleteRow {}

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

function readDocumentCategoryStatus(metadata: Record<string, unknown>): string {
  return String(metadata.categoryStatus ?? metadata.reviewStatus ?? metadata.status ?? 'PENDING')
    .trim()
    .toUpperCase();
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
  replacedDocument: ReplacedContractDocumentRow | null;
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

  if (isContractSideApproved(params.contract, resolvedSide)) {
    throw mutationError(409, SIDE_ALREADY_APPROVED_MESSAGE, {
      code: SIDE_ALREADY_APPROVED_CODE,
    });
  }

  const replaceDocumentIdRaw =
    params.body.replaceDocumentId ?? params.body.replace_document_id;
  const replaceDocumentId = Number(replaceDocumentIdRaw);
  if (
    replaceDocumentIdRaw != null &&
    (!Number.isInteger(replaceDocumentId) || replaceDocumentId <= 0)
  ) {
    throw mutationError(400, 'ID do documento a substituir inválido.');
  }
  const isDocumentOperator =
    params.req.userRole === 'admin' &&
    params.req.adminValidated === true &&
    params.req.adminRole === 'document_operator';
  if (isDocumentOperator && !Number.isInteger(replaceDocumentId)) {
    throw mutationError(403, 'A conta administrativa documental só pode substituir documentos pendentes.', {
      code: 'ADMIN_DOCUMENT_CREATE_FORBIDDEN',
    });
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

  let replacedDocument: ReplacedContractDocumentRow | null = null;
  if (Number.isInteger(replaceDocumentId) && replaceDocumentId > 0) {
    const [replacementRows] = await tx.query<ReplacedContractDocumentRow[]>(
      `
        SELECT id, type, document_type, metadata_json, created_at,
               storage_provider, storage_bucket, storage_key, storage_content_type,
               storage_size_bytes, storage_etag
        FROM negotiation_documents
        WHERE id = ? AND negotiation_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [replaceDocumentId, params.contract.negotiation_id]
    );
    const candidate = replacementRows[0];
    if (!candidate) {
      throw mutationError(404, 'Documento a substituir não encontrado neste contrato.');
    }
    const candidateMetadata = parseStoredJsonObject(candidate.metadata_json);
    const candidateSide = readDocumentOwnerSide(candidateMetadata);
    const candidateType = String(candidate.document_type ?? '').trim().toLowerCase();
    const candidateCategory =
      normalizeContractDocumentCategory(candidateMetadata.documentCategory) ??
      resolveDocumentCategoryFromType(candidateType as ContractDocumentType);
    const currentSideStatus = String(
      resolvedSide === 'seller'
        ? params.contract.seller_approval_status
        : params.contract.buyer_approval_status
    ).trim().toUpperCase();
    if (
      String(candidateMetadata.contractId ?? '').trim() !== params.contractId ||
      candidateSide !== resolvedSide ||
      candidateType !== normalizedDocumentType ||
      candidateCategory !== resolvedDocumentCategory
    ) {
      throw mutationError(409, 'O documento a substituir não pertence ao mesmo slot do contrato.');
    }
    if (readDocumentCategoryStatus(candidateMetadata) !== 'PENDING') {
      throw mutationError(409, 'Somente documentos pendentes podem ser substituídos.');
    }
    if (currentSideStatus !== 'PENDING') {
      throw mutationError(409, 'Reinicie a análise deste lado antes de substituir documentos.');
    }
    replacedDocument = candidate;
  }
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

  if (resolvedDocumentCategory && !isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental) {
    const approvedDocumentId = await findApprovedContractDocument(tx, {
      contractId: params.contractId,
      negotiationId: params.contract.negotiation_id,
      side: resolvedSide,
      category: resolvedDocumentCategory,
      documentType: normalizedDocumentType,
    });
    if (approvedDocumentId !== null) {
      throw mutationError(409, DOCUMENT_ALREADY_APPROVED_MESSAGE, {
        code: DOCUMENT_ALREADY_APPROVED_CODE,
      });
    }

    if (!replacedDocument) {
      const pendingDocumentId = await findPendingContractDocument(tx, {
        contractId: params.contractId,
        negotiationId: params.contract.negotiation_id,
        side: resolvedSide,
        category: resolvedDocumentCategory,
        documentType: normalizedDocumentType,
      });
      if (pendingDocumentId !== null) {
        throw mutationError(
          409,
          'Já existe um documento em análise neste campo. Substitua a versão existente para enviar outro arquivo.',
          { code: 'DOCUMENT_PENDING_ALREADY_EXISTS' }
        );
      }
    }
  }

  const uploadEvent: ContractAuditEvent = {
    action: replacedDocument
      ? 'document_replaced'
      : role === 'admin' && currentStatus !== 'AWAITING_DOCS'
        ? 'admin_read_only_bypass_document_upload'
        : 'document_upload',
    at: new Date().toISOString(),
    by: Number(params.req.userId ?? 0) || null,
    role: role || null,
    details: {
      side: resolvedSide,
      documentType: normalizedDocumentType,
      category: resolvedDocumentCategory,
      ...(replacedDocument ? { replacedDocumentId: Number(replacedDocument.id) } : {}),
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

  let documentId: number;
  try {
    documentId = await storeNegotiationDocumentToR2({
      executor: tx,
      negotiationId: params.contract.negotiation_id,
      type: resolveDocumentStorageType(normalizedDocumentType),
      documentType: normalizedDocumentType,
      content: params.uploadedFile.buffer,
      contentType: params.uploadedFile.mimetype,
      metadataJson: metadataWithAudit,
    });
  } catch (error) {
    if (isInvalidNegotiationDocumentContentError(error)) {
      throw mutationError(error.statusCode, error.message, { code: error.code });
    }
    throw error;
  }

  if (replacedDocument) {
    await tx.query(
      'DELETE FROM negotiation_documents WHERE id = ? AND negotiation_id = ? LIMIT 1',
      [replacedDocument.id, params.contract.negotiation_id]
    );
    await enqueueNegotiationDocumentDeletion(tx, replacedDocument, {
      negotiationId: params.contract.negotiation_id,
      requestedByUserId: Number(params.req.userId ?? 0) || null,
      requestSource: 'contract_document_replace',
    });
  }

  const shouldMarkOnlineSignatureMethod =
    role !== 'admin' && normalizedDocumentType === 'contrato_assinado';
  const nextWorkflowMetadata = clearAwaitingDocumentResubmission(
    appendWorkflowAuditEvent(
    params.contract.workflow_metadata,
    uploadEvent
    ),
    resolvedSide
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
    replacedDocument,
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

  const status = resolveContractStatus(params.contract.status);
  const isActiveDraftUnderReview =
    status === 'AWAITING_MINUTE_REVIEW' &&
    documentType === 'contrato_minuta' &&
    Number(params.contract.draft_review_document_id ?? 0) === Number(document.id);
  if (isActiveDraftUnderReview) {
    throw mutationError(
      409,
      'A minuta em revisão não pode ser excluída diretamente. Substitua a minuta ou volte a etapa do contrato antes de removê-la.',
      { code: 'CONTRACT_DRAFT_IN_REVIEW' }
    );
  }

  try {
    assertParticipantMutationAllowed(params.contract, context, 'document_delete');
  } catch (error) {
    if (isContractWorkflowGuardError(error)) {
      throw mutationError(error.statusCode, error.message, { code: error.code });
    }
    throw error;
  }
  const isUploader = Number(metadata.uploadedBy) === Number(params.req.userId);
  const isAdmin = context.userRole === 'admin';

  if (side && isContractSideApproved(params.contract, side)) {
    throw mutationError(409, SIDE_ALREADY_APPROVED_MESSAGE, {
      code: SIDE_ALREADY_APPROVED_CODE,
    });
  }

  if (side === 'seller' && !context.canEditSeller && !isAdmin) {
    throw mutationError(403, 'Seu acesso não permite remover documentos do lado vendedor nesta etapa.');
  }
  if (side === 'buyer' && !context.canEditBuyer && !isAdmin) {
    throw mutationError(403, 'Seu acesso não permite remover documentos do lado comprador nesta etapa.');
  }
  if (!side && !isAdmin && !isUploader && !context.canEditSeller && !context.canEditBuyer) {
    throw mutationError(403, 'Seu acesso não permite remover este documento.');
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
