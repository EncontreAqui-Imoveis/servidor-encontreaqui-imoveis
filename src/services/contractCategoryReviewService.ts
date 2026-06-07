import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import { getContractDbConnection } from './contractPersistenceService';
import type { ContractRow } from '../controllers/ContractController';
import {
  isContractDocumentCategoryStatus,
  type ContractApprovalStatus,
  type ContractDocumentCategoryCode,
  type ContractDocumentCategoryStatus,
  type ContractStatus,
} from '../modules/contracts/domain/contract.types';
import {
  findCategoryRequirement,
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

type ContractCategoryReviewInput = {
  contractIdInput: unknown;
  sideInput: unknown;
  categoryInput: unknown;
  statusInput: unknown;
  reasonInput: unknown;
  reasonCodeInput: unknown;
  userIdInput: unknown;
  userRoleInput: unknown;
  loadContractForUpdate: (tx: PoolConnection, contractId: string) => Promise<ContractRow | null>;
};

type ContractCategoryReviewResult = {
  message: string;
  contract: ContractRow | null;
};

class ContractCategoryReviewError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function contractCategoryReviewError(
  statusCode: number,
  message: string
): ContractCategoryReviewError {
  return new ContractCategoryReviewError(statusCode, message);
}

export function isContractCategoryReviewError(
  error: unknown
): error is ContractCategoryReviewError {
  return error instanceof ContractCategoryReviewError;
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

function resolveContractStatus(value: unknown): ContractStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'AWAITING_DOCS' ||
    normalized === 'IN_DRAFT' ||
    normalized === 'AWAITING_SIGNATURES' ||
    normalized === 'FINALIZED'
    ? normalized
    : 'AWAITING_DOCS';
}

function resolveCategoryStatus(value: unknown): ContractDocumentCategoryStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (normalized === 'APPROVED_WITH_RES') return 'APPROVED_WITH_RES';
  if (isContractDocumentCategoryStatus(normalized)) return normalized;
  return 'PENDING';
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

function shouldMoveToDraft(
  contract: ContractRow,
  sellerStatus: ContractApprovalStatus,
  buyerStatus: ContractApprovalStatus
): boolean {
  return (
    resolveContractStatus(contract.status) === 'AWAITING_DOCS' &&
    (sellerStatus === 'APPROVED' || sellerStatus === 'APPROVED_WITH_RES') &&
    (buyerStatus === 'APPROVED' || buyerStatus === 'APPROVED_WITH_RES')
  );
}

function buildContractDocumentRuleContextFromRow(
  row: ContractRow
): ContractDocumentRuleContext {
  return {
    propertyPurpose: row.property_purpose,
    sellerInfo: parseStoredJsonObject(row.seller_info),
    buyerInfo: parseStoredJsonObject(row.buyer_info),
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
  side: ContractDocumentSide | null;
  documentCategory: ContractDocumentCategoryCode | null;
  categoryStatus: ContractDocumentCategoryStatus;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

function mapDocument(row: ContractDocumentRow): ContractDocumentMapped {
  const metadata = parseStoredJsonObject(row.metadata_json);
  const side = parseDocumentSide(metadata.side);
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

  return {
    id: Number(row.id),
    side,
    documentCategory,
    categoryStatus,
    metadata,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function buildInitialCategoryProgress(
  side: ContractDocumentSide,
  matrixContext: ContractDocumentRuleContext
): Map<ContractDocumentCategoryCode, ContractDocumentProgressItem> {
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
      pending: categories.filter((item) => item.required && item.status === 'PENDING').length,
      approved: categories.filter((item) => item.required && item.status === 'APPROVED').length,
      rejected: categories.filter((item) => item.required && item.status === 'REJECTED').length,
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

async function fetchCategoryValidationRows(
  tx: PoolConnection,
  contract: ContractRow
): Promise<ContractDocumentRow[]> {
  const [rows] = await tx.query<ContractDocumentRow[]>(
    `
      SELECT id, type, document_type, metadata_json, created_at
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
        AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
      ORDER BY created_at DESC, id DESC
    `,
    [contract.negotiation_id, contract.id]
  );
  return rows;
}

function hasRequiredCategoryGateApproval(input: {
  rows: ContractDocumentRow[];
  contract: ContractRow;
}): boolean {
  const mapped = input.rows.map((row) => mapDocument(row));
  const matrixContext = buildContractDocumentRuleContextFromRow(input.contract);
  const progress = buildContractDocumentProgress(
    mapped.map((document) => ({
      ...document,
      metadata: document.metadata as Record<string, unknown>,
    })),
    matrixContext
  );
  const sideReady = (side: ContractDocumentProgressSide) =>
    side.categories.every((item) => {
      const status = String(item.status ?? '').trim().toUpperCase();
      return (
        !item.required ||
        status === 'APPROVED' ||
        status === 'APPROVED_WITH_RES' ||
        status === 'NOT_APPLICABLE'
      );
    });
  return sideReady(progress.seller) && sideReady(progress.buyer);
}

function appendAuditTrail(
  source: unknown,
  event: ContractAuditEvent
): Record<string, unknown> {
  return appendAuditTrailEvent(source, event);
}

function buildAuditEvent(input: {
  side: ContractDocumentSide;
  category: ContractDocumentCategoryCode;
  status: ContractDocumentCategoryStatus;
  reason: string;
  reasonCode: string;
  evaluatedBy: number | null;
  userRole: string | null;
}): ContractAuditEvent {
  return {
    action: 'admin_category_review',
    at: new Date().toISOString(),
    by: input.evaluatedBy,
    role: input.userRole,
    details: {
      side: input.side,
      category: input.category,
      status: input.status,
      reason: input.reason || null,
      reasonCode: input.reasonCode || null,
    },
  };
}

async function updateCategoryDocuments(
  tx: PoolConnection,
  rows: ContractDocumentRow[],
  auditEvent: ContractAuditEvent,
  status: ContractDocumentCategoryStatus,
  reasonText: string,
  reasonCode: string
): Promise<void> {
  for (const row of rows) {
    const metadata = parseStoredJsonObject(row.metadata_json);
    const nextMetadata = appendAuditTrail(metadata, auditEvent);
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

export async function evaluateContractCategory(
  input: ContractCategoryReviewInput
): Promise<ContractCategoryReviewResult> {
  const contractId = String(input.contractIdInput ?? '').trim();
  if (!contractId) {
    throw contractCategoryReviewError(400, 'ID do contrato inválido.');
  }

  const side = parseDocumentSide(input.sideInput);
  const category = normalizeContractDocumentCategory(input.categoryInput);
  const status = resolveCategoryStatus(input.statusInput);
  const reasonText = String(input.reasonInput ?? '').trim();
  const reasonCode = String(input.reasonCodeInput ?? '').trim().toUpperCase();

  if (!side) {
    throw contractCategoryReviewError(400, "Lado inválido. Use 'seller' ou 'buyer'.");
  }
  if (!category) {
    throw contractCategoryReviewError(400, 'Categoria documental inválida.');
  }
  if (!isContractDocumentCategoryStatus(status)) {
    throw contractCategoryReviewError(400, 'Status categorial inválido.');
  }
  if (status === 'REJECTED' && reasonText.length < 3) {
    throw contractCategoryReviewError(
      400,
      'Motivo obrigatório para rejeição por categoria.'
    );
  }

  const tx = await getContractDbConnection();
  try {
    await tx.beginTransaction();

    const contract = await input.loadContractForUpdate(tx, contractId);
    if (!contract) {
      await tx.rollback();
      throw contractCategoryReviewError(404, 'Contrato não encontrado.');
    }
    if (resolveContractStatus(contract.status) !== 'AWAITING_DOCS') {
      await tx.rollback();
      throw contractCategoryReviewError(
        400,
        'Revisão por categoria só é permitida em AWAITING_DOCS.'
      );
    }

    const ruleContext = buildContractDocumentRuleContextFromRow(contract);
    const categoryRule = findCategoryRequirement(side, category, ruleContext);
    if (!categoryRule) {
      await tx.rollback();
      throw contractCategoryReviewError(
        400,
        'Categoria inválida para o lado informado.'
      );
    }
    if (categoryRule.applicability === 'not_applicable') {
      await tx.rollback();
      throw contractCategoryReviewError(
        400,
        'Esta categoria não se aplica ao contrato atual (perfil/finalidade).'
      );
    }

    const rows = await fetchCategoryValidationRows(tx, contract);
    const targetDocs = rows.filter((row) => {
      const mapped = mapDocument(row);
      return mapped.side === side && mapped.documentCategory === category;
    });
    if (targetDocs.length === 0) {
      await tx.rollback();
      throw contractCategoryReviewError(
        404,
        'Nenhum documento encontrado para a categoria e lado informados.'
      );
    }

    const actorId = Number(input.userIdInput ?? 0);
    const actorRole = String(input.userRoleInput ?? '').trim().toLowerCase() || null;
    const auditEvent = buildAuditEvent({
      side,
      category,
      status,
      reason: reasonText,
      reasonCode,
      evaluatedBy: Number.isFinite(actorId) && actorId > 0 ? actorId : null,
      userRole: actorRole,
    });

    await updateCategoryDocuments(tx, targetDocs, auditEvent, status, reasonText, reasonCode);

    const updatedRows = await fetchCategoryValidationRows(tx, contract);
    const matrixContext = buildContractDocumentRuleContextFromRow(contract);
    const progress = buildContractDocumentProgress(
      updatedRows.map((row) => {
        const mapped = mapDocument(row);
        return {
          ...mapped,
          metadata: mapped.metadata as Record<string, unknown>,
        };
      }),
      matrixContext
    );

    const nextSellerStatus = resolveSideApprovalFromCategoryProgress(progress.seller);
    const nextBuyerStatus = resolveSideApprovalFromCategoryProgress(progress.buyer);
    const effectiveStatuses = {
      sellerStatus: nextSellerStatus,
      buyerStatus: nextBuyerStatus,
    };
    const mustMoveBySide = shouldMoveToDraft(
      contract,
      effectiveStatuses.sellerStatus,
      effectiveStatuses.buyerStatus
    );
    const mustMoveByCategories = hasRequiredCategoryGateApproval({
      rows: updatedRows,
      contract,
    });
    const nextContractStatus: ContractStatus =
      mustMoveBySide && mustMoveByCategories ? 'IN_DRAFT' : 'AWAITING_DOCS';

    const nextWorkflowMetadata = appendContractWorkflowAuditEvent(
      contract.workflow_metadata,
      auditEvent
    );
    const sellerReason =
      side === 'seller'
        ? parseStoredJsonObject(
            reasonText
              ? {
                  reason: reasonText,
                  evaluatedAt: auditEvent.at,
                  evaluatedBy: auditEvent.by,
                }
              : null
          )
        : parseStoredJsonObject(contract.seller_approval_reason);
    const buyerReason =
      side === 'buyer'
        ? parseStoredJsonObject(
            reasonText
              ? {
                  reason: reasonText,
                  evaluatedAt: auditEvent.at,
                  evaluatedBy: auditEvent.by,
                }
              : null
          )
        : parseStoredJsonObject(contract.buyer_approval_reason);

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
        JSON.stringify(sellerReason),
        JSON.stringify(buyerReason),
        JSON.stringify(nextWorkflowMetadata),
        nextContractStatus,
        contractId,
      ]
    );

    const updatedContract = await input.loadContractForUpdate(tx, contractId);
    await tx.commit();

    return {
      message: 'Revisão por categoria atualizada com sucesso.',
      contract: updatedContract
        ? {
            ...updatedContract,
            status: nextContractStatus,
            seller_approval_status: effectiveStatuses.sellerStatus,
            buyer_approval_status: effectiveStatuses.buyerStatus,
            seller_approval_reason: JSON.stringify(sellerReason),
            buyer_approval_reason: JSON.stringify(buyerReason),
          }
        : null,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}
