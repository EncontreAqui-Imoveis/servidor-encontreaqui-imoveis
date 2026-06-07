import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { storeNegotiationDocumentToR2 } from './negotiationDocumentStorageService';
import {
  buildContractDocumentRuleContextFromRow,
  type ContractRow,
  resolveContractStatus,
} from '../controllers/ContractController';
import {
  resolveDocumentCategoryFromType,
  resolveFallbackDocumentTypeByCategory,
  validateContractDocumentUpload,
  type ContractDocumentSide,
} from '../modules/contracts/domain/contractDocumentValidation';
import { isUploadBlockedForNotApplicableCategory } from '../modules/contracts/domain/contractDocumentRuleMatrix';
import type {
  ContractApprovalStatus,
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
    'dados_bancarios',
    'docs_imovel',
    'outro',
  ]);
  return allowed.has(normalized as ContractDocumentCategoryCode)
    ? (normalized as ContractDocumentCategoryCode)
    : null;
}

function mergeStoredJsonObject(
  originalValue: unknown,
  patch: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...parseStoredJsonObject(originalValue),
    ...patch,
  };
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

function appendContractWorkflowAuditEvent(
  source: unknown,
  event: ContractAuditEvent
): Record<string, unknown> {
  const metadata = parseStoredJsonObject(source);
  const current = Array.isArray(metadata.contractAuditTrail)
    ? metadata.contractAuditTrail
    : [];
  return {
    ...metadata,
    contractAuditTrail: [...current, event],
  };
}

function parseDocumentSide(value: unknown): ContractDocumentSide | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'seller' || normalized === 'buyer') {
    return normalized;
  }
  return null;
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

function parseContractApprovalStatus(value: unknown): ContractApprovalStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'APPROVED_WITH_RES'
    ? 'APPROVED_WITH_RES'
    : normalized === 'APPROVED'
      ? 'APPROVED'
      : normalized === 'REJECTED'
        ? 'REJECTED'
        : 'PENDING';
}

function approvalStatusAllowsEditing(status: ContractApprovalStatus): boolean {
  return status === 'PENDING' || status === 'REJECTED';
}

function isDoubleEndedDeal(contract: ContractRow): boolean {
  if (contract.capturing_broker_id == null || contract.selling_broker_id == null) {
    return false;
  }
  return Number(contract.capturing_broker_id) === Number(contract.selling_broker_id);
}

function canEditSellerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (Number.isFinite(userId) && userId > 0) {
    if (role === 'client') {
      return (
        userId === Number(contract.property_owner_id ?? 0) ||
        userId === Number(contract.seller_client_id ?? 0)
      );
    }
    return userId === Number(contract.capturing_broker_id ?? 0);
  }

  return false;
}

function canEditBuyerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (Number.isFinite(userId) && userId > 0) {
    if (role === 'client') {
      return userId === Number(contract.buyer_client_id ?? 0);
    }
    return userId === Number(contract.capturing_broker_id ?? 0);
  }

  return false;
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
  const role = String(params.req.userRole ?? '').toLowerCase();
  const isSupplementalOther = normalizedDocumentType === 'outro';
  const isAdminSupplemental =
    role === 'admin' && isAdminSupplementalDocumentType(normalizedDocumentType);
  const currentStatus = resolveContractStatus(params.contract.status);

  if (isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental) {
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
  if (!isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental) {
    if (currentStatus !== 'AWAITING_DOCS' && currentStatus !== 'IN_DRAFT') {
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

  const doubleEnded = isDoubleEndedDeal(params.contract);
  const canEditSeller = canEditSellerSide(params.req, params.contract);
  const canEditBuyer = canEditBuyerSide(params.req, params.contract);

  const resolvedSide: ContractDocumentSide | null = (
    isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental
      ? requestedSide
      : (() => {
          if (requestedSide) {
            return requestedSide;
          }
          if (doubleEnded) {
            return 'seller';
          }
          if (canEditSeller && !canEditBuyer) {
            return 'seller';
          }
          if (canEditBuyer && !canEditSeller) {
            return 'buyer';
          }
          return null;
        })()
  );

  if (
    !isSignedDocumentType(normalizedDocumentType) &&
    !isAdminSupplemental &&
    resolvedSide == null
  ) {
    throw mutationError(
      400,
      'Informe o lado do documento (side: seller|buyer) para documentos de AWAITING_DOCS.'
    );
  }

  if (resolvedSide === 'seller' && !canEditSeller && role !== 'admin' && !doubleEnded) {
    throw mutationError(403, 'Somente o proprietário pode anexar documentos do lado owner.');
  }

  if (resolvedSide === 'buyer' && !canEditBuyer && role !== 'admin' && !doubleEnded) {
    throw mutationError(403, 'Somente o comprador pode anexar documentos do lado buyer.');
  }

  if (!isSignedDocumentType(normalizedDocumentType) && role !== 'admin') {
    const sellerStatus = parseContractApprovalStatus(params.contract.seller_approval_status);
    const buyerStatus = parseContractApprovalStatus(params.contract.buyer_approval_status);

    if (resolvedSide === 'seller' && !approvalStatusAllowsEditing(sellerStatus)) {
      throw mutationError(
        403,
        'Documentos do lado seller não podem ser enviados após aprovação.'
      );
    }

    if (resolvedSide === 'buyer' && !approvalStatusAllowsEditing(buyerStatus)) {
      throw mutationError(
        403,
        'Documentos do lado buyer não podem ser enviados após aprovação.'
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
    requiresSide: !isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental,
    requiresCategory:
      !isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental,
  });
  if (!uploadValidation.isValid) {
    throw mutationError(422, 'Documento inválido para a categoria informada.', {
      validationResult: uploadValidation,
    });
  }

  const uploadEvent: ContractAuditEvent = {
    action: 'document_upload',
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
  metadataWithAudit.side = resolvedSide;
  metadataWithAudit.documentCategory = resolvedDocumentCategory;
  metadataWithAudit.categoryStatus =
    isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental
      ? 'APPROVED'
      : 'PENDING';
  metadataWithAudit.validationResult = uploadValidation;
  metadataWithAudit.originalFileName = params.uploadedFile.originalname ?? null;
  metadataWithAudit.uploadedBy = Number(params.req.userId ?? 0) || null;
  metadataWithAudit.uploadedAt = uploadEvent.at;

  const documentId = await storeNegotiationDocumentToR2({
    executor: tx,
    negotiationId: params.contract.negotiation_id,
    type: resolveDocumentStorageType(normalizedDocumentType),
    documentType: normalizedDocumentType,
    content: params.uploadedFile.buffer,
    metadataJson: metadataWithAudit,
  });

  const shouldMarkOnlineSignatureMethod =
    role !== 'admin' && normalizedDocumentType === 'contrato_assinado';
  const nextWorkflowMetadata = appendContractWorkflowAuditEvent(
    params.contract.workflow_metadata,
    uploadEvent
  );

  if (shouldMarkOnlineSignatureMethod) {
    const signatureAwareWorkflowMetadata = mergeStoredJsonObject(nextWorkflowMetadata, {
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
  const side = parseDocumentSide(metadata.side);
  const documentType = String(document.document_type ?? '').trim().toLowerCase();
  const signedDocument = isSignedDocumentType(documentType);

  const role = String(params.req.userRole ?? '').toLowerCase();
  const canEditSeller = canEditSellerSide(params.req, params.contract);
  const canEditBuyer = canEditBuyerSide(params.req, params.contract);
  const doubleEnded = isDoubleEndedDeal(params.contract);

  if (side === 'seller' && !canEditSeller && role !== 'admin' && !doubleEnded) {
    throw mutationError(403, 'Somente o proprietário pode remover documentos do lado owner.');
  }

  if (side === 'buyer' && !canEditBuyer && role !== 'admin' && !doubleEnded) {
    throw mutationError(403, 'Somente o comprador pode remover documentos do lado buyer.');
  }

  if (!signedDocument) {
    const sellerStatus = parseContractApprovalStatus(params.contract.seller_approval_status);
    const buyerStatus = parseContractApprovalStatus(params.contract.buyer_approval_status);

    if (side === 'seller' && !approvalStatusAllowsEditing(sellerStatus)) {
      throw mutationError(
        403,
        'Documentos do lado seller não podem ser removidos após aprovação.'
      );
    }

    if (side === 'buyer' && !approvalStatusAllowsEditing(buyerStatus)) {
      throw mutationError(
        403,
        'Documentos do lado buyer não podem ser removidos após aprovação.'
      );
    }

    if (side == null) {
      const canEditAtLeastOneSide =
        approvalStatusAllowsEditing(sellerStatus) ||
        approvalStatusAllowsEditing(buyerStatus);
      if (!canEditAtLeastOneSide) {
        throw mutationError(403, 'Documento não pode ser removido após aprovação.');
      }
    }
  }

  await tx.query(
    `
      DELETE FROM negotiation_documents
      WHERE id = ? AND negotiation_id = ?
      LIMIT 1
    `,
    [params.documentId, params.contract.negotiation_id]
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

export function isContractDocumentMutationError(
  error: unknown
): error is ContractDocumentMutationError {
  return error instanceof ContractDocumentMutationError;
}
