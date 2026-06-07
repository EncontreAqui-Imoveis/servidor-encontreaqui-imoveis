import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import { createUserNotification } from './notificationService';
import { getContractDbConnection } from './contractPersistenceService';
import type { ContractRow } from '../controllers/ContractController';
import {
  isContractApprovalStatus,
  isContractDocumentCategoryStatus,
  type ContractApprovalStatus,
  type ContractDocumentCategoryCode,
  type ContractDocumentCategoryStatus,
  type ContractStatus,
} from '../modules/contracts/domain/contract.types';
import {
  resolveDocumentRequirementsForContract,
  type ContractDocumentRuleContext,
} from '../modules/contracts/domain/contractDocumentRuleMatrix';
import {
  resolveDocumentCategoryFromType,
  type ContractDocumentSide,
} from '../modules/contracts/domain/contractDocumentValidation';

type ContractDocumentRow = RowDataPacket & {
  id: number | string;
  type: string | null;
  document_type: string | null;
  metadata_json: unknown;
  created_at: string | Date | null;
};

type ContractAuditEvent = {
  action: string;
  at: string;
  by: number | null;
  role: string | null;
  details: Record<string, unknown>;
};

type ContractApprovalSideReviewInput = {
  contractIdInput: unknown;
  sideInput: unknown;
  statusInput: unknown;
  reasonInput: unknown;
  userIdInput: unknown;
  userRoleInput: unknown;
  loadContractForUpdate: (tx: PoolConnection, contractId: string) => Promise<ContractRow | null>;
};

type ContractApprovalSideReviewResult = {
  message: string;
  contract: ContractRow | null;
  movedToDraft: boolean;
};

class ContractSideReviewError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function contractSideReviewError(statusCode: number, message: string): ContractSideReviewError {
  return new ContractSideReviewError(statusCode, message);
}

export function isContractSideReviewError(error: unknown): error is ContractSideReviewError {
  return error instanceof ContractSideReviewError;
}

const APPROVAL_GRANTS_PROGRESS = new Set<ContractApprovalStatus>([
  'APPROVED',
  'APPROVED_WITH_RES',
]);

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

function buildContractDocumentRuleContextFromRow(row: ContractRow): ContractDocumentRuleContext {
  return {
    propertyPurpose: row.property_purpose,
    sellerInfo: parseStoredJsonObject(row.seller_info),
    buyerInfo: parseStoredJsonObject(row.buyer_info),
  };
}

function resolveContractStatus(value: unknown): ContractStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'AWAITING_DOCS' ||
    normalized === 'IN_DRAFT' ||
    normalized === 'AWAITING_SIGNATURES' ||
    normalized === 'FINALIZED'
    ? normalized
    : 'AWAITING_DOCS';
}

function resolveContractApprovalStatus(value: unknown): ContractApprovalStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (isContractApprovalStatus(normalized)) {
    return normalized;
  }
  return 'PENDING';
}

function parseContractApprovalStatusInput(
  value: unknown
): ContractApprovalStatus | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return isContractApprovalStatus(normalized) ? normalized : null;
}

function normalizeApprovalReason(
  reason: unknown,
  evaluatedBy: number | null
): Record<string, unknown> | null {
  const message = String(reason ?? '').trim();
  if (!message) {
    return null;
  }

  return {
    reason: message,
    evaluatedAt: new Date().toISOString(),
    evaluatedBy,
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

function normalizeContractDocumentCategory(
  value: unknown
): ContractDocumentCategoryCode | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const allowed = new Set<ContractDocumentCategoryCode>([
    'identidade',
    'comprovante_endereco',
    'estado_civil',
    'conjuge_documentos',
    'comprovante_renda',
    'dados_bancarios',
    'docs_imovel',
  ]);
  return allowed.has(normalized as ContractDocumentCategoryCode)
    ? (normalized as ContractDocumentCategoryCode)
    : null;
}

function resolveCategoryStatus(value: unknown): ContractDocumentCategoryStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'APPROVED_WITH_RES') return 'APPROVED_WITH_RES';
  if (isContractDocumentCategoryStatus(normalized)) return normalized;
  return 'PENDING';
}

function approvalStatusAllowsProgress(status: ContractApprovalStatus): boolean {
  return APPROVAL_GRANTS_PROGRESS.has(status);
}

function resolveSideApprovalFromCategoryProgress(
  sideProgress: ContractDocumentProgressSide
): ContractApprovalStatus {
  const required = sideProgress.categories.filter((item) => item.required);
  if (required.some((item) => item.status === 'REJECTED')) {
    return 'REJECTED';
  }
  if (
    required.length > 0 &&
    required.every(
      (item) => item.status === 'APPROVED' || item.status === 'APPROVED_WITH_RES'
    )
  ) {
    if (required.some((item) => item.status === 'APPROVED_WITH_RES')) {
      return 'APPROVED_WITH_RES';
    }
    return 'APPROVED';
  }
  if (
    required.some(
      (item) => item.status === 'APPROVED' || item.status === 'APPROVED_WITH_RES'
    )
  ) {
    return 'APPROVED_WITH_RES';
  }
  return 'PENDING';
}

function resolveApprovalStatusesForProgress(
  _contract: ContractRow,
  input: {
    sellerStatus: ContractApprovalStatus;
    buyerStatus: ContractApprovalStatus;
  }
): {
  sellerStatus: ContractApprovalStatus;
  buyerStatus: ContractApprovalStatus;
} {
  return input;
}

function shouldMoveToDraft(
  contract: ContractRow,
  sellerStatus: ContractApprovalStatus,
  buyerStatus: ContractApprovalStatus
): boolean {
  const currentStatus = resolveContractStatus(contract.status);
  if (currentStatus !== 'AWAITING_DOCS') {
    return false;
  }
  return (
    approvalStatusAllowsProgress(sellerStatus) &&
    approvalStatusAllowsProgress(buyerStatus)
  );
}

function isDoubleEndedDeal(contract: ContractRow): boolean {
  if (contract.capturing_broker_id == null || contract.selling_broker_id == null) {
    return false;
  }
  return Number(contract.capturing_broker_id) === Number(contract.selling_broker_id);
}

function resolveContractPropertyTitle(contract: ContractRow): string {
  const title = String(contract.property_title ?? '').trim();
  return title || 'Imóvel sem título';
}

function resolveApprovalSideLabel(
  contract: ContractRow,
  side: 'seller' | 'buyer'
): string {
  if (isDoubleEndedDeal(contract)) {
    return 'documentação do contrato';
  }

  return side === 'seller' ? 'documentação do proprietário' : 'documentação do comprador';
}

function resolveNegotiationBrokerRecipientIds(contract: ContractRow): number[] {
  return Array.from(
    new Set(
      [contract.capturing_broker_id]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );
}

function resolveContractNotificationRecipientIds(contract: ContractRow): number[] {
  const brokers = resolveNegotiationBrokerRecipientIds(contract);
  const clientId = Number(contract.buyer_client_id ?? 0);
  const ownerId = Number(contract.property_owner_id ?? 0);
  return Array.from(
    new Set(
      [...brokers, clientId, ownerId].filter(
        (value) => Number.isFinite(value) && value > 0
      )
    )
  );
}

function readMetadataText(
  metadata: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = String(metadata[key] ?? '').trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function buildInitialCategoryProgress(
  side: ContractDocumentSide,
  matrixContext: ContractDocumentRuleContext
): Map<
  ContractDocumentCategoryCode,
  ContractDocumentProgressItem
> {
  const { seller, buyer } = resolveDocumentRequirementsForContract(matrixContext);
  const requirements = side === 'seller' ? seller : buyer;
  return new Map(
    requirements.map((req) => {
      const isNotApplicable = req.applicability === 'not_applicable';
      return [
        req.category,
        {
          category: req.category,
          status: (isNotApplicable
            ? 'NOT_APPLICABLE'
            : 'PENDING') as ContractDocumentCategoryStatus,
          uploadedCount: 0,
          required: req.required,
          latestDocumentId: null,
          latestUploadedAt: null,
        },
      ];
    })
  );
}

function summarizeCategorySide(
  side: ContractDocumentSide,
  mappedDocuments: Array<ContractDocumentMapped & { metadata: Record<string, unknown> }>,
  matrixContext: ContractDocumentRuleContext
): ContractDocumentProgressSide {
  const categoryMap = buildInitialCategoryProgress(side, matrixContext);
  for (const document of mappedDocuments) {
    if (document.side !== side) continue;
    const category =
      document.documentCategory ??
      normalizeContractDocumentCategory(document.metadata.documentCategory);
    if (!category) continue;
    const previous = categoryMap.get(category);
    if (!previous) continue;
    if (previous.status === 'NOT_APPLICABLE' && previous.required === false) {
      continue;
    }
    const previousTime = previous?.latestUploadedAt
      ? new Date(previous.latestUploadedAt).getTime()
      : 0;
    const currentTime = document.createdAt ? new Date(document.createdAt).getTime() : 0;
    const isLatest = currentTime >= previousTime;
    const nextStatus = isLatest
      ? resolveCategoryStatus(document.categoryStatus)
      : (previous?.status ?? 'PENDING');
    categoryMap.set(category, {
      category,
      status: nextStatus,
      uploadedCount: Number(previous?.uploadedCount ?? 0) + 1,
      required: previous?.required ?? true,
      latestDocumentId: isLatest ? document.id : previous?.latestDocumentId ?? null,
      latestUploadedAt: isLatest
        ? document.createdAt
        : (previous?.latestUploadedAt ?? null),
    });
  }

  const categories = Array.from(categoryMap.values());
  return {
    side,
    categories,
    totals: {
      pending: categories.filter(
        (item) => item.required && item.status === 'PENDING'
      ).length,
      approved: categories.filter(
        (item) => item.required && item.status === 'APPROVED'
      ).length,
      rejected: categories.filter(
        (item) => item.required && item.status === 'REJECTED'
      ).length,
    },
  };
}

function buildContractDocumentProgress(
  mappedDocuments: Array<ContractDocumentMapped & { metadata: Record<string, unknown> }>,
  matrixContext: ContractDocumentRuleContext
): ContractDocumentProgressSummary {
  return {
    seller: summarizeCategorySide('seller', mappedDocuments, matrixContext),
    buyer: summarizeCategorySide('buyer', mappedDocuments, matrixContext),
  };
}

function mapDocument(row: ContractDocumentRow): ContractDocumentMapped {
  const metadata = parseStoredJsonObject(row.metadata_json);
  const sideValue = String(metadata.side ?? '').trim().toLowerCase();
  const side: ContractDocumentSide | null =
    sideValue === 'seller' || sideValue === 'buyer'
      ? sideValue
      : null;
  const originalFileNameRaw = String(metadata.originalFileName ?? '').trim();
  const normalizedRowDocumentType = String(row.document_type ?? '').trim().toLowerCase();
  const rowCategory =
    normalizedRowDocumentType
      ? resolveDocumentCategoryFromType(normalizedRowDocumentType as never)
      : null;
  const documentCategory =
    normalizeContractDocumentCategory(metadata.documentCategory) ?? rowCategory;
  const categoryStatus = resolveCategoryStatus(
    metadata.categoryStatus ?? metadata.reviewStatus ?? metadata.status
  );
  const reviewReason = String(
    metadata.reviewReason ??
      metadata.reason ??
      metadata.validationReason ??
      ''
  ).trim();
  const validationResult =
    metadata.validationResult &&
    typeof metadata.validationResult === 'object' &&
    !Array.isArray(metadata.validationResult)
      ? (metadata.validationResult as Record<string, unknown>)
      : null;

  return {
    id: Number(row.id),
    type: row.type,
    documentType: row.document_type,
    side,
    documentCategory,
    categoryStatus,
    reviewReason: reviewReason || null,
    validationResult,
    originalFileName: originalFileNameRaw || null,
    metadata,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function parseDocumentRows(
  rows: ContractDocumentRow[]
): Array<ContractDocumentMapped & { metadata: Record<string, unknown> }> {
  return rows.map((row) => {
    const mapped = mapDocument(row);
    return {
      ...mapped,
      metadata: mapped.metadata as Record<string, unknown>,
    };
  });
}

function buildDocumentReviewAuditEvent(
  input: {
    side: ContractDocumentSide;
    status: ContractDocumentCategoryStatus;
    reason: string;
    evaluatedBy: number | null;
    reasonCode: string | null;
    userRole: string | null;
    category?: ContractDocumentCategoryCode | null;
  }
): ContractAuditEvent {
  return {
    action: 'admin_side_review',
    at: new Date().toISOString(),
    by: input.evaluatedBy,
    role: input.userRole,
    details: {
      side: input.side,
      category: input.category ?? null,
      status: input.status,
      reason: input.reason || null,
      reasonCode: input.reasonCode || null,
    },
  };
}

interface ContractDocumentProgressItem {
  category: ContractDocumentCategoryCode;
  status: ContractDocumentCategoryStatus;
  uploadedCount: number;
  required: boolean;
  latestDocumentId: number | null;
  latestUploadedAt: string | null;
}

interface ContractDocumentProgressSide {
  side: ContractDocumentSide;
  categories: ContractDocumentProgressItem[];
  totals: {
    pending: number;
    approved: number;
    rejected: number;
  };
}

interface ContractDocumentProgressSummary {
  seller: ContractDocumentProgressSide;
  buyer: ContractDocumentProgressSide;
}

interface ContractDocumentMapped {
  id: number;
  type: string | null;
  documentType: string | null;
  side: ContractDocumentSide | null;
  documentCategory: ContractDocumentCategoryCode | null;
  categoryStatus: ContractDocumentCategoryStatus;
  reviewReason: string | null;
  validationResult: Record<string, unknown> | null;
  originalFileName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

function parseSideStatus(
  contract: ContractRow,
  nextSellerStatus: ContractApprovalStatus,
  nextBuyerStatus: ContractApprovalStatus
): {
  sellerStatus: ContractApprovalStatus;
  buyerStatus: ContractApprovalStatus;
} {
  return resolveApprovalStatusesForProgress(contract, {
    sellerStatus: nextSellerStatus,
    buyerStatus: nextBuyerStatus,
  });
}

async function updateDocumentsMetadata(
  tx: PoolConnection,
  rows: ContractDocumentRow[],
  auditEvent: ContractAuditEvent,
  status: ContractDocumentCategoryStatus,
  reasonText: string,
  reasonCode: string,
  actorId: number | null
): Promise<void> {
  for (const row of rows) {
    const metadata = parseStoredJsonObject(row.metadata_json);
    const nextMetadata = appendAuditTrailEvent(metadata, auditEvent);
    nextMetadata.categoryStatus = status;
    nextMetadata.reviewStatus = status;
    nextMetadata.reviewReason = reasonText || null;
    nextMetadata.reviewReasonCode = reasonCode || null;
    nextMetadata.reviewedAt = auditEvent.at;
    nextMetadata.reviewedBy = auditEvent.by;
    nextMetadata.validationResult = {
      isValid: status !== 'REJECTED',
      status,
      issues:
        status === 'REJECTED'
          ? [
              {
                code: reasonCode || 'CATEGORY_INVALID',
                message: reasonText || 'Categoria rejeitada na revisão.',
              },
            ]
          : [],
    };
    await tx.query(
      `
        UPDATE negotiation_documents
        SET metadata_json = CAST(? AS JSON)
        WHERE id = ?
      `,
      [JSON.stringify(nextMetadata), Number(row.id)]
    );
  }
}

async function fetchRowsForSide(
  tx: PoolConnection,
  contract: ContractRow,
  side: ContractDocumentSide
): Promise<ContractDocumentRow[]> {
  const [rows] = await tx.query<ContractDocumentRow[]>(
    `
      SELECT id, type, document_type, metadata_json, created_at
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND COALESCE(document_type, '') <> 'proposal'
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.side')) = ?
      ORDER BY id DESC
    `,
    [contract.negotiation_id, String(contract.id), side]
  );
  return rows;
}

export async function evaluateContractSide(
  input: ContractApprovalSideReviewInput
): Promise<ContractApprovalSideReviewResult> {
  const contractId = String(input.contractIdInput ?? '').trim();
  if (!contractId) {
    throw contractSideReviewError(400, 'ID do contrato inválido.');
  }

  const side = String(input.sideInput ?? '').trim().toLowerCase();
  if (side !== 'seller' && side !== 'buyer') {
    throw contractSideReviewError(400, "Lado inválido. Use 'seller' ou 'buyer'.");
  }

  const nextSideStatus = parseContractApprovalStatusInput(input.statusInput);
  if (!nextSideStatus) {
    throw contractSideReviewError(
      400,
      'Status inválido. Use PENDING, APPROVED, APPROVED_WITH_RES ou REJECTED.'
    );
  }

  const reasonText = String(input.reasonInput ?? '').trim();
  if (
    (nextSideStatus === 'APPROVED_WITH_RES' || nextSideStatus === 'REJECTED') &&
    reasonText.length < 3
  ) {
    throw contractSideReviewError(
      400,
      'Motivo é obrigatório para aprovação com ressalvas e rejeição.'
    );
  }

  const evaluatedBy = Number(input.userIdInput);
  const reasonPayload = normalizeApprovalReason(
    reasonText,
    Number.isFinite(evaluatedBy) ? evaluatedBy : null
  );

  const tx = await getContractDbConnection();
  try {
    await tx.beginTransaction();

    const contract = await input.loadContractForUpdate(tx, contractId);
    if (!contract) {
      await tx.rollback();
      throw contractSideReviewError(404, 'Contrato não encontrado.');
    }

    if (resolveContractStatus(contract.status) !== 'AWAITING_DOCS') {
      await tx.rollback();
      throw contractSideReviewError(
        400,
        'A avaliação granular só é permitida em AWAITING_DOCS.'
      );
    }

    let nextSellerStatus = resolveContractApprovalStatus(
      contract.seller_approval_status
    );
    let nextBuyerStatus = resolveContractApprovalStatus(
      contract.buyer_approval_status
    );
    let nextSellerReason = parseStoredJsonObject(contract.seller_approval_reason);
    let nextBuyerReason = parseStoredJsonObject(contract.buyer_approval_reason);

    const sideReason = reasonPayload ?? {};
    if (side === 'seller') {
      nextSellerStatus = nextSideStatus;
      nextSellerReason = sideReason;
    } else {
      nextBuyerStatus = nextSideStatus;
      nextBuyerReason = sideReason;
    }

    const normalizedCategoryStatus: ContractDocumentCategoryStatus =
      nextSideStatus === 'REJECTED'
        ? 'REJECTED'
        : nextSideStatus === 'PENDING'
          ? 'PENDING'
          : 'APPROVED';
    const reviewAuditEvent = buildDocumentReviewAuditEvent({
      side: side as ContractDocumentSide,
      status: nextSideStatus,
      reason: reasonText,
      evaluatedBy: Number.isFinite(evaluatedBy) ? evaluatedBy : null,
      reasonCode: null,
      userRole: String(input.userRoleInput ?? '').trim().toLowerCase() || null,
    });

    const docRows = await fetchRowsForSide(tx, contract, side as ContractDocumentSide);
    await updateDocumentsMetadata(
      tx,
      docRows,
      reviewAuditEvent,
      normalizedCategoryStatus,
      reasonText,
      '',
      Number.isFinite(evaluatedBy) ? evaluatedBy : null
    );

    const effectiveStatuses = resolveApprovalStatusesForProgress(contract, {
      sellerStatus: nextSellerStatus,
      buyerStatus: nextBuyerStatus,
    });
    const mustMoveToDraft = shouldMoveToDraft(
      contract,
      effectiveStatuses.sellerStatus,
      effectiveStatuses.buyerStatus
    );
    const nextContractStatus: ContractStatus = mustMoveToDraft
      ? 'IN_DRAFT'
      : 'AWAITING_DOCS';
    const shouldReleasePropertyAvailability = nextSideStatus === 'REJECTED';
    const nextWorkflowMetadata = appendContractWorkflowAuditEvent(
      contract.workflow_metadata,
      reviewAuditEvent
    );

    await tx.query(
      `
        UPDATE contracts
        SET
          seller_approval_status = ?,
          buyer_approval_status = ?,
          seller_approval_reason = CAST(? AS JSON),
          buyer_approval_reason = CAST(? AS JSON),
          workflow_metadata = CAST(? AS JSON),
          status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        effectiveStatuses.sellerStatus,
        effectiveStatuses.buyerStatus,
        JSON.stringify(nextSellerReason),
        JSON.stringify(nextBuyerReason),
        JSON.stringify(nextWorkflowMetadata),
        nextContractStatus,
        contractId,
      ]
    );

    if (shouldReleasePropertyAvailability) {
      await tx.query(
        `
          UPDATE negotiations
          SET status = 'IN_NEGOTIATION'
          WHERE id = ?
        `,
        [contract.negotiation_id]
      );
      await tx.query(
        `
          UPDATE properties
          SET
            status = 'approved',
            visibility = 'PUBLIC',
            lifecycle_status = 'AVAILABLE'
          WHERE id = ?
            AND lifecycle_status NOT IN ('SOLD', 'RENTED')
            AND status NOT IN ('sold', 'rented')
        `,
        [contract.property_id]
      );
    }

    const updated = await input.loadContractForUpdate(tx, contractId);
    await tx.commit();

    if (nextSideStatus === 'APPROVED_WITH_RES' && reasonText.length > 0) {
      const recipientIds = resolveContractNotificationRecipientIds(contract);
      const propertyTitle = resolveContractPropertyTitle(contract);
      const sideLabel = resolveApprovalSideLabel(contract, side as 'seller' | 'buyer');

      for (const recipientId of recipientIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Contrato aprovado com ressalvas',
            message: `O admin aprovou com ressalvas a ${sideLabel} do contrato do imóvel "${propertyTitle}". Observação: ${reasonText}`,
            recipientId,
            relatedEntityId: Number(contract.property_id),
            metadata: {
              contractId,
              negotiationId: contract.negotiation_id,
              side: isDoubleEndedDeal(contract) ? 'both' : side,
              status: nextSideStatus,
              reason: reasonText,
            },
          });
        } catch (notificationError) {
          console.error(
            'Falha ao notificar sobre aprovação com ressalvas do contrato:',
            notificationError
          );
        }
      }
    }

    if (nextSideStatus === 'REJECTED' && reasonText.length > 0) {
      const recipientIds = resolveContractNotificationRecipientIds(contract);
      const propertyTitle = resolveContractPropertyTitle(contract);
      const sideLabel = resolveApprovalSideLabel(contract, side as 'seller' | 'buyer');

      for (const recipientId of recipientIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Documentação rejeitada',
            message: `A documentação (${sideLabel}) do contrato do imóvel "${propertyTitle}" foi rejeitada. Motivo: ${reasonText}. O contrato não aparecerá mais na sua lista até nova análise, se aplicável.`,
            recipientId,
            relatedEntityId: Number(contract.property_id),
            metadata: {
              contractId,
              negotiationId: contract.negotiation_id,
              side: isDoubleEndedDeal(contract) ? 'both' : side,
              status: nextSideStatus,
              reason: reasonText,
            },
          });
        } catch (notificationError) {
          console.error(
            'Falha ao notificar sobre rejeição da documentação do contrato:',
            notificationError
          );
        }
      }
    }

    return {
      message: 'Avaliação do lado atualizada com sucesso.',
      contract: updated,
      movedToDraft: mustMoveToDraft,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
