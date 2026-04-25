import { Request, Response } from 'express';
import JSZip from 'jszip';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import { deleteCloudinaryAsset } from '../config/cloudinary';
import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import {
  createAdminNotification,
  createUserNotification,
} from '../services/notificationService';
import {
  getContractDbConnection,
  queryContractRows,
} from '../services/contractPersistenceService';
import {
  deleteNegotiationDocumentObject,
  readNegotiationDocumentObject,
  storeNegotiationDocumentToR2,
} from '../services/negotiationDocumentStorageService';
import {
  isContractApprovalStatus,
  isContractDocumentCategoryStatus,
  isContractDocumentType,
  isContractStatus,
  type ContractApprovalStatus,
  type ContractDocumentType,
  type ContractDocumentCategoryCode,
  type ContractDocumentCategoryStatus,
  type ContractStatus,
} from '../modules/contracts/domain/contract.types';
import {
  findCategoryRequirement,
  isUploadBlockedForNotApplicableCategory,
  resolveDocumentRequirementsForContract,
  type ContractDocumentRuleContext,
} from '../modules/contracts/domain/contractDocumentRuleMatrix';
import {
  resolveDocumentCategoryFromType,
  resolveFallbackDocumentTypeByCategory,
  type ContractDocumentSide,
  validateContractDocumentUpload,
} from '../modules/contracts/domain/contractDocumentValidation';

const ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT = new Set([
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
  'SOLD',
  'RENTED',
]);

const CONTRACT_STATUS_FLOW: ContractStatus[] = [
  'AWAITING_DOCS',
  'IN_DRAFT',
  'AWAITING_SIGNATURES',
  'FINALIZED',
];

const CONTRACT_STATUS_SET = new Set<ContractStatus>(CONTRACT_STATUS_FLOW);

const APPROVAL_GRANTS_PROGRESS = new Set<ContractApprovalStatus>([
  'APPROVED',
  'APPROVED_WITH_RES',
]);

interface NegotiationForContractRow extends RowDataPacket {
  id: string;
  property_id: number;
  status: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  property_title: string | null;
}

interface ContractRow extends RowDataPacket {
  id: string;
  negotiation_id: string;
  property_id: number;
  status: string;
  seller_info: unknown;
  buyer_info: unknown;
  commission_data: unknown;
  workflow_metadata: unknown;
  seller_approval_status: string;
  buyer_approval_status: string;
  seller_approval_reason: unknown;
  buyer_approval_reason: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  buyer_client_id: number | null;
  property_title: string | null;
  property_purpose: string | null;
  property_code: string | null;
  property_owner_id: number | null;
  property_owner_name: string | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
  capturing_agency_name: string | null;
  capturing_agency_address: string | null;
  responsible_user_ids: string | null;
}

interface ContractDocumentRow extends RowDataPacket {
  id: number;
  type: string;
  document_type: string | null;
  metadata_json: unknown;
  created_at: Date | string | null;
}

interface ContractDocumentDownloadRow extends ContractDocumentRow {
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
}

interface ContractDocumentForDeleteRow extends RowDataPacket {
  id: number;
  type: string;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  storage_content_type: string | null;
  storage_size_bytes: number | null;
  storage_etag: string | null;
}

interface ContractDocumentListRow extends ContractDocumentRow {
  negotiation_id: string;
}

interface CommissionContractRow extends RowDataPacket {
  id: string;
  negotiation_id: string;
  property_id: number;
  property_title: string | null;
  property_code: string | null;
  property_purpose: string | null;
  updated_at: Date | string | null;
  commission_data: unknown;
  signed_proposal_document_id: number | null;
}

interface ExistingContractRow extends RowDataPacket {
  id: string;
  status: string;
}

interface ContractDataBody {
  sellerInfo?: unknown;
  seller_info?: unknown;
  ownerInfo?: unknown;
  owner_info?: unknown;
  buyerInfo?: unknown;
  buyer_info?: unknown;
}

interface UploadContractDocumentBody {
  documentType?: unknown;
  document_type?: unknown;
  documentCategory?: unknown;
  document_category?: unknown;
  side?: unknown;
}

interface TransitionBody {
  direction?: unknown;
}

interface EvaluateSideBody {
  side?: unknown;
  status?: unknown;
  reason?: unknown;
}

interface EvaluateCategoryBody {
  side?: unknown;
  category?: unknown;
  status?: unknown;
  reason?: unknown;
  reasonCode?: unknown;
}

interface FinalizeBody {
  commission_data?: unknown;
  commissionData?: unknown;
}

interface UpdateCommissionDataBody {
  commission_data?: unknown;
  commissionData?: unknown;
}

interface SignatureMethodBody {
  method?: unknown;
}

interface NormalizedCommissionData {
  valorVenda: number;
  comissaoCaptador: number;
  comissaoVendedor: number;
  taxaPlataforma: number;
}

interface ContractDocumentGateCounts {
  draftTotal: number;
  signedContractTotal: number;
  paymentReceiptTotal: number;
  inspectionBoletoTotal: number;
}

interface ContractDocumentCategoryProgressItem {
  category: ContractDocumentCategoryCode;
  status: ContractDocumentCategoryStatus;
  uploadedCount: number;
  required: boolean;
  latestDocumentId: number | null;
  latestUploadedAt: string | null;
}

interface ContractDocumentProgressSide {
  side: ContractDocumentSide;
  categories: ContractDocumentCategoryProgressItem[];
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

interface ContractAuditEvent {
  action: string;
  at: string;
  by: number | null;
  role: string | null;
  details?: Record<string, unknown>;
}

type ContractDocumentDeleteScope = 'linked_only' | 'linked_or_legacy';

type CloudinaryAssetReference = {
  publicId: string | null;
  url: string | null;
  resourceType: string | null;
};

function normalizeJsonObject(
  value: unknown,
  fieldName: string,
  options?: { emptyStringAsNull?: boolean }
): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed && options?.emptyStringAsNull) {
      return null;
    }
    if (!trimmed) {
      throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new Error();
    } catch {
      throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error(`${fieldName} deve ser um objeto JSON válido.`);
}

function parseStoredJsonObject(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
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

function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function resolveContractStatus(value: unknown): ContractStatus {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (isContractStatus(normalized)) {
    return normalized;
  }
  return 'AWAITING_DOCS';
}

function parseSignatureMethodInput(value: unknown): 'in_person' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'in_person' ? 'in_person' : null;
}

function parseContractStatusFilter(value: unknown): ContractStatus | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return CONTRACT_STATUS_SET.has(normalized as ContractStatus)
    ? (normalized as ContractStatus)
    : null;
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

function approvalStatusAllowsProgress(status: ContractApprovalStatus): boolean {
  return APPROVAL_GRANTS_PROGRESS.has(status);
}

function approvalStatusAllowsEditing(status: ContractApprovalStatus): boolean {
  return status === 'PENDING' || status === 'REJECTED';
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

function parseDocumentSide(value: unknown): 'seller' | 'buyer' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
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

function parseNonNegativeNumber(value: unknown, fieldName: string): number {
  const numericValue =
    typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error(`${fieldName} deve ser um número maior ou igual a zero.`);
  }
  return Number(numericValue.toFixed(2));
}

function parseCurrencyLikeNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readCommissionValue(
  source: Record<string, unknown>,
  key: string
): number {
  return Number(parseCurrencyLikeNumber(source[key]).toFixed(2));
}

function normalizeCommissionData(value: unknown): NormalizedCommissionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('commission_data inválido.');
  }

  const payload = value as Record<string, unknown>;
  const valorVenda = parseNonNegativeNumber(payload.valorVenda, 'valorVenda');
  if (valorVenda <= 0) {
    throw new Error('valorVenda deve ser maior que zero.');
  }

  const comissaoCaptador = parseNonNegativeNumber(
    payload.comissaoCaptador,
    'comissaoCaptador'
  );
  const comissaoVendedor = parseNonNegativeNumber(
    payload.comissaoVendedor,
    'comissaoVendedor'
  );
  const taxaPlataforma = parseNonNegativeNumber(
    payload.taxaPlataforma,
    'taxaPlataforma'
  );

  const totalSplits = Number(
    (comissaoCaptador + comissaoVendedor + taxaPlataforma).toFixed(2)
  );
  if (totalSplits > valorVenda) {
    throw new Error(
      'Dados financeiros inconsistentes: soma de comissões e taxa não pode exceder valorVenda.'
    );
  }

  return {
    valorVenda,
    comissaoCaptador,
    comissaoVendedor,
    taxaPlataforma,
  };
}

function resolveFinalDealStatuses(propertyPurpose: string | null): {
  propertyStatus: 'sold' | 'rented';
  lifecycleStatus: 'SOLD' | 'RENTED';
  negotiationStatus: 'SOLD' | 'RENTED';
} {
  const normalizedPurpose = String(propertyPurpose ?? '').toLowerCase();
  const isRentalOnly =
    normalizedPurpose.includes('alug') && !normalizedPurpose.includes('venda');

  if (isRentalOnly) {
    return {
      propertyStatus: 'rented',
      lifecycleStatus: 'RENTED',
      negotiationStatus: 'RENTED',
    };
  }

  return {
    propertyStatus: 'sold',
    lifecycleStatus: 'SOLD',
    negotiationStatus: 'SOLD',
  };
}

function resolveActingBrokerName(req: AuthRequest, contract: ContractRow): string {
  const userId = Number(req.userId ?? 0);
  if (userId > 0 && userId === Number(contract.capturing_broker_id ?? 0)) {
    const name = String(contract.capturing_broker_name ?? '').trim();
    if (name) return name;
  }
  return userId > 0 ? `Corretor #${userId}` : 'Corretor';
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

/** Corretores envolvidos + cliente comprador (quando existir), para notificações de contrato. */
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

function toDocumentCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchContractDocumentGateCounts(
  tx: PoolConnection,
  contract: Pick<ContractRow, 'id' | 'negotiation_id'>
): Promise<ContractDocumentGateCounts> {
  const [rows] = await tx.query<RowDataPacket[]>(
    `
      SELECT
        SUM(
          CASE
            WHEN document_type = 'contrato_minuta'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS draft_total,
        SUM(
          CASE
            WHEN document_type = 'contrato_assinado'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS signed_contract_total,
        SUM(
          CASE
            WHEN document_type = 'comprovante_pagamento'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS payment_receipt_total,
        SUM(
          CASE
            WHEN document_type = 'boleto_vistoria'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND UPPER(
                COALESCE(
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.status')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.reviewStatus')),
                  JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.validationStatus')),
                  'APPROVED'
                )
              ) <> 'REJECTED'
            THEN 1 ELSE 0
          END
        ) AS inspection_boleto_total
      FROM negotiation_documents
      WHERE negotiation_id = ?
    `,
    [
      contract.id,
      contract.id,
      contract.id,
      contract.id,
      contract.negotiation_id,
    ]
  );

  const row = rows[0] ?? {};
  return {
    draftTotal: toDocumentCount(row.draft_total),
    signedContractTotal: toDocumentCount(row.signed_contract_total),
    paymentReceiptTotal: toDocumentCount(row.payment_receipt_total),
    inspectionBoletoTotal: toDocumentCount(row.inspection_boleto_total),
  };
}

async function fetchContractCategoryValidationRows(
  tx: PoolConnection,
  contract: Pick<ContractRow, 'id' | 'negotiation_id'>
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
  doubleEnded: boolean;
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
    side.categories.every(
      (item) => {
        const status = String(item.status ?? '').trim().toUpperCase();
        return (
          !item.required ||
          status === 'APPROVED' ||
          status === 'APPROVED_WITH_RES' ||
          status === 'NOT_APPLICABLE'
        );
      }
    );
  const sellerReady = sideReady(progress.seller);
  if (input.doubleEnded) {
    return sellerReady;
  }
  return sellerReady && sideReady(progress.buyer);
}

const OWNER_SENSITIVE_KEYS = new Set([
  'dados_bancarios',
  'dadosBancarios',
  'bankData',
  'bank_data',
  'bankAccount',
  'bank_account',
  'pix',
  'pixKey',
  'pix_key',
  'agencia',
  'conta',
  'commission',
  'commissionData',
  'commission_data',
]);

function canViewOwnerSensitiveData(req: AuthRequest | null, row: ContractRow): boolean {
  if (!req) return false;
  const role = String(req.userRole ?? '').trim().toLowerCase();
  if (role === 'admin') {
    return true;
  }
  const userId = Number(req.userId ?? 0);
  return Number.isFinite(userId) && userId > 0 && userId === Number(row.capturing_broker_id ?? 0);
}

function redactOwnerInfoByRole(
  ownerInfo: Record<string, unknown>,
  canViewSensitiveData: boolean
): Record<string, unknown> {
  if (canViewSensitiveData) {
    return ownerInfo;
  }
  const redactedEntries = Object.entries(ownerInfo).filter(
    ([key]) => !OWNER_SENSITIVE_KEYS.has(key)
  );
  return Object.fromEntries(redactedEntries);
}

function shouldExposeOwnerSensitiveDocument(
  input: {
    side: ContractDocumentSide | null;
    documentCategory: ContractDocumentCategoryCode | null;
  },
  canViewSensitiveData: boolean
): boolean {
  if (canViewSensitiveData) return true;
  return !(input.side === 'seller' && input.documentCategory === 'dados_bancarios');
}

function mapContract(row: ContractRow, req: AuthRequest | null = null) {
  const documentRequirements = resolveDocumentRequirementsForContract(
    buildContractDocumentRuleContextFromRow(row)
  );
  const ownerInfo = parseStoredJsonObject(row.seller_info);
  const canViewSensitiveData = canViewOwnerSensitiveData(req, row);
  const ownerInfoForViewer = redactOwnerInfoByRole(ownerInfo, canViewSensitiveData);
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    propertyId: Number(row.property_id),
    status: resolveContractStatus(row.status),
    ownerInfo: ownerInfoForViewer,
    // Compatibilidade legada: sellerInfo segue disponível no wire, mas semântica canônica é ownerInfo.
    sellerInfo: ownerInfoForViewer,
    buyerInfo: parseStoredJsonObject(row.buyer_info),
    commissionData: canViewSensitiveData ? parseStoredJsonObject(row.commission_data) : {},
    workflowMetadata: parseStoredJsonObject(row.workflow_metadata),
    sellerApprovalStatus: resolveContractApprovalStatus(row.seller_approval_status),
    ownerApprovalStatus: resolveContractApprovalStatus(row.seller_approval_status),
    buyerApprovalStatus: resolveContractApprovalStatus(row.buyer_approval_status),
    sellerApprovalReason: parseStoredJsonObject(row.seller_approval_reason),
    ownerApprovalReason: parseStoredJsonObject(row.seller_approval_reason),
    buyerApprovalReason: parseStoredJsonObject(row.buyer_approval_reason),
    capturingBrokerId:
      row.capturing_broker_id !== null ? Number(row.capturing_broker_id) : null,
    sellingBrokerId:
      row.selling_broker_id !== null ? Number(row.selling_broker_id) : null,
    buyerClientId: row.buyer_client_id !== null ? Number(row.buyer_client_id) : null,
    capturingBrokerName: row.capturing_broker_name ?? null,
    sellingBrokerName: row.selling_broker_name ?? null,
    ownerId: row.property_owner_id !== null ? Number(row.property_owner_id) : null,
    ownerName: row.property_owner_name ?? null,
    propertyTitle: row.property_title ?? null,
    propertyCode: row.property_code ?? null,
    propertyPurpose: row.property_purpose ?? null,
    agencyName: row.capturing_agency_name ?? null,
    agencyAddress: row.capturing_agency_address ?? null,
    documentRequirements,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapDocument(row: ContractDocumentRow) {
  const metadata = parseStoredJsonObject(row.metadata_json);
  const sideValue = String(metadata.side ?? '').trim().toLowerCase();
  const side: ContractDocumentSide | null =
    sideValue === 'seller' || sideValue === 'buyer'
      ? sideValue
      : null;
  const originalFileNameRaw = String(metadata.originalFileName ?? '').trim();
  const normalizedRowDocumentType = String(row.document_type ?? '').trim().toLowerCase();
  const rowCategory =
    isContractDocumentType(normalizedRowDocumentType)
      ? resolveDocumentCategoryFromType(normalizedRowDocumentType)
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
    createdAt: toIsoString(row.created_at),
  };
}

function buildInitialCategoryProgress(
  side: ContractDocumentSide,
  matrixContext: ContractDocumentRuleContext
): Map<ContractDocumentCategoryCode, ContractDocumentCategoryProgressItem> {
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
  mappedDocuments: Array<
    ReturnType<typeof mapDocument> & { metadata: Record<string, unknown> }
  >,
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
  mappedDocuments: Array<
    ReturnType<typeof mapDocument> & { metadata: Record<string, unknown> }
  >,
  matrixContext: ContractDocumentRuleContext
): ContractDocumentProgressSummary {
  return {
    seller: summarizeCategorySide('seller', mappedDocuments, matrixContext),
    buyer: summarizeCategorySide('buyer', mappedDocuments, matrixContext),
  };
}

function mapContractWithDocumentProgress(
  row: ContractRow,
  documentRows: ContractDocumentRow[],
  req: AuthRequest | null = null
): ReturnType<typeof mapContract> & {
  documentProgress: ContractDocumentProgressSummary;
  documents: Array<ReturnType<typeof mapDocument> & { downloadUrl: string }>;
} {
  const canViewSensitiveData = canViewOwnerSensitiveData(req, row);
  const documents = documentRows
    .filter((document) => !isProposalDocument(document))
    .filter((document) => !isRejectedNegotiationDocumentRow(document))
    .map((document) => ({
      ...mapDocument(document),
      downloadUrl: `/negotiations/${row.negotiation_id}/documents/${document.id}/download`,
    }))
    .filter((document) =>
      shouldExposeOwnerSensitiveDocument(
        {
          side: document.side,
          documentCategory: document.documentCategory,
        },
        canViewSensitiveData
      )
    );

  const matrixContext = buildContractDocumentRuleContextFromRow(row);
  const progress = buildContractDocumentProgress(
    documents.map((document) => ({
      ...document,
      metadata: parseStoredJsonObject(document.metadata),
    })),
    matrixContext
  );

  return {
    ...mapContract(row, req),
    documentProgress: progress,
    documents,
  };
}

function isProposalDocument(document: {
  document_type?: string | null;
  type?: string | null;
  documentType?: string | null;
}): boolean {
  const normalizedDocumentType = String(
    document.document_type ?? document.documentType ?? ''
  )
    .trim()
    .toLowerCase();
  const normalizedType = String(document.type ?? '').trim().toLowerCase();
  return normalizedDocumentType === 'proposal' || normalizedType === 'proposal';
}

function isRejectedNegotiationDocumentRow(row: ContractDocumentRow): boolean {
  const metadata = parseStoredJsonObject(row.metadata_json);
  const status = String(
    metadata.status ?? metadata.reviewStatus ?? metadata.validationStatus ?? 'APPROVED'
  )
    .trim()
    .toUpperCase();
  return status === 'REJECTED';
}

type AdminContractDocument = ReturnType<typeof mapDocument> & {
  downloadUrl: string;
};

function resolveDocumentStorageType(documentType: string): 'contract' | 'other' {
  if (documentType === 'contrato_minuta' || documentType === 'contrato_assinado') {
    return 'contract';
  }
  return 'other';
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

function buildContractDocumentDeleteWhereClause(
  scope: ContractDocumentDeleteScope
): string {
  if (scope === 'linked_only') {
    return `
      negotiation_id = ?
      AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
      AND COALESCE(document_type, '') <> 'proposal'
      AND COALESCE(type, '') <> 'proposal'
    `;
  }

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

async function fetchDocumentsForContractScope(
  tx: PoolConnection,
  contract: Pick<ContractRow, 'id' | 'negotiation_id'>,
  scope: ContractDocumentDeleteScope
): Promise<ContractDocumentForDeleteRow[]> {
  const [rows] = await tx.query<ContractDocumentForDeleteRow[]>(
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
      WHERE ${buildContractDocumentDeleteWhereClause(scope)}
      ORDER BY id DESC
    `,
    [contract.negotiation_id, contract.id]
  );

  return rows;
}

function logContractAdminAudit(
  req: Request,
  action: string,
  details: Record<string, unknown>
): void {
  console.info('Contract admin audit:', {
    requestId: getRequestId(req),
    action,
    ...details,
  });
}

function extractCloudinaryAssetReference(
  document: Pick<ContractDocumentForDeleteRow, 'metadata_json'>
): CloudinaryAssetReference | null {
  const metadata = parseStoredJsonObject(document.metadata_json);
  const publicId = readMetadataText(metadata, [
    'cloudinaryPublicId',
    'cloudinary_public_id',
    'publicId',
    'public_id',
  ]);
  const url = readMetadataText(metadata, [
    'cloudinaryUrl',
    'cloudinary_url',
    'secureUrl',
    'secure_url',
    'fileUrl',
    'file_url',
    'url',
  ]);
  const resourceType = readMetadataText(metadata, [
    'cloudinaryResourceType',
    'cloudinary_resource_type',
    'resourceType',
    'resource_type',
  ]);

  if (!publicId && !url) {
    return null;
  }

  return {
    publicId,
    url,
    resourceType,
  };
}

function resetWorkflowMetadataForRestart(value: unknown): Record<string, unknown> | null {
  const metadata = parseStoredJsonObject(value);
  const nextMetadata = { ...metadata };
  const keysToRemove = [
    'signatureMethod',
    'signatureMethodDeclaredAt',
    'signatureMethodDeclaredBy',
    'signatureMethodDeclaredByName',
    'signedContractUploadedOnlineAt',
    'signedContractUploadedOnlineBy',
    'agencySignedContractReceivedAt',
    'agencySignedContractReceivedBy',
  ];

  for (const key of keysToRemove) {
    delete nextMetadata[key];
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

function resetWorkflowMetadataForStepBack(value: unknown): Record<string, unknown> | null {
  const metadata = parseStoredJsonObject(value);
  const nextMetadata = { ...metadata };
  const keysToRemove = [
    'signatureMethod',
    'signatureMethodDeclaredAt',
    'signatureMethodDeclaredBy',
    'signatureMethodDeclaredByName',
    'signedContractUploadedOnlineAt',
    'signedContractUploadedOnlineBy',
    'agencySignedContractReceivedAt',
    'agencySignedContractReceivedBy',
  ];

  for (const key of keysToRemove) {
    delete nextMetadata[key];
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : null;
}

function resolveRollbackDocumentTypes(targetStatus: ContractStatus): string[] {
  if (targetStatus === 'IN_DRAFT') {
    return ['contrato_assinado', 'comprovante_pagamento', 'boleto_vistoria', 'outro'];
  }

  if (targetStatus === 'AWAITING_DOCS') {
    return [
      'contrato_minuta',
      'contrato_assinado',
      'comprovante_pagamento',
      'boleto_vistoria',
      'outro',
    ];
  }

  return [];
}

async function fetchDocumentsForStepBackCleanup(
  tx: PoolConnection,
  contract: Pick<ContractRow, 'id' | 'negotiation_id'>,
  targetStatus: ContractStatus
): Promise<ContractDocumentForDeleteRow[]> {
  const documentTypes = resolveRollbackDocumentTypes(targetStatus);
  if (documentTypes.length === 0) {
    return [];
  }

  const placeholders = documentTypes.map(() => '?').join(', ');
  const [rows] = await tx.query<ContractDocumentForDeleteRow[]>(
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
      WHERE negotiation_id = ?
        AND COALESCE(document_type, '') IN (${placeholders})
        AND COALESCE(type, '') <> 'proposal'
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
          OR (
            JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
            AND COALESCE(document_type, '') <> 'outro'
          )
        )
      ORDER BY id DESC
    `,
    [contract.negotiation_id, ...documentTypes, contract.id]
  );

  return rows;
}

async function cleanupContractDocumentAssets(
  documents: ContractDocumentForDeleteRow[],
  context: {
    action: string;
    contractId: string;
    negotiationId: string;
  }
): Promise<{ attempted: number; failed: number }> {
  let attempted = 0;
  let failed = 0;

  for (const document of documents) {
    const hasNegotiationObject =
      String(document.storage_provider ?? '').trim().toUpperCase() === 'R2' &&
      String(document.storage_bucket ?? '').trim().length > 0 &&
      String(document.storage_key ?? '').trim().length > 0;
    const assetReference = extractCloudinaryAssetReference(document);

    if (hasNegotiationObject) {
      attempted += 1;
      try {
        await deleteNegotiationDocumentObject(document);
      } catch (error) {
        failed += 1;
        console.error('Falha ao excluir objeto R2 do documento do contrato:', {
          action: context.action,
          contractId: context.contractId,
          negotiationId: context.negotiationId,
          documentId: Number(document.id ?? 0),
          documentType: document.document_type ?? null,
          storageKey: String(document.storage_key ?? ''),
          error,
        });
      }
    }

    if (assetReference) {
      attempted += 1;
      try {
        await deleteCloudinaryAsset({
          publicId: assetReference.publicId,
          url: assetReference.url,
          resourceType: assetReference.resourceType,
          invalidate: true,
        });
      } catch (error) {
        failed += 1;
        console.error('Falha ao excluir asset externo do documento do contrato:', {
          action: context.action,
          contractId: context.contractId,
          negotiationId: context.negotiationId,
          documentId: Number(document.id ?? 0),
          documentType: document.document_type ?? null,
          error,
        });
      }
    }
  }

  return { attempted, failed };
}

function isNegotiationResponsibleUser(contract: ContractRow, userId: number): boolean {
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  const raw = String(contract.responsible_user_ids ?? '').trim();
  if (!raw) {
    return false;
  }
  return raw
    .split(',')
    .map((value) => Number(value))
    .some((value) => Number.isInteger(value) && value === userId);
}

function canAccessContract(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }

  const isResponsible = isNegotiationResponsibleUser(contract, userId);
  if (isResponsible && (role === 'broker' || role === 'auxiliary_administrative')) {
    return true;
  }

  if (role === 'client') {
    return (
      userId === Number(contract.buyer_client_id ?? 0) ||
      userId === Number(contract.property_owner_id ?? 0)
    );
  }

  if (role !== 'broker' && role !== 'auxiliary_administrative') {
    return false;
  }

  return (
    userId === Number(contract.capturing_broker_id ?? 0) ||
    userId === Number(contract.selling_broker_id ?? 0)
  );
}

function canEditSellerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (isNegotiationResponsibleUser(contract, userId)) {
    return true;
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  if (role === 'client') {
    return userId === Number(contract.property_owner_id ?? 0);
  }
  return userId === Number(contract.capturing_broker_id ?? 0);
}

function canEditBuyerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  if (isNegotiationResponsibleUser(contract, userId)) {
    return true;
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    return false;
  }
  if (role === 'client') {
    return userId === Number(contract.buyer_client_id ?? 0);
  }
  return userId === Number(contract.capturing_broker_id ?? 0);
}

function isDoubleEndedDeal(contract: ContractRow): boolean {
  if (contract.capturing_broker_id == null || contract.selling_broker_id == null) {
    return false;
  }
  return Number(contract.capturing_broker_id) === Number(contract.selling_broker_id);
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

  if (isDoubleEndedDeal(contract)) {
    return approvalStatusAllowsProgress(sellerStatus);
  }

  return (
    approvalStatusAllowsProgress(sellerStatus) &&
    approvalStatusAllowsProgress(buyerStatus)
  );
}

function shouldTreatContractAsSingleClientFlow(contract: ContractRow): boolean {
  const ownerId = Number(contract.property_owner_id ?? 0);
  const buyerId = Number(contract.buyer_client_id ?? 0);
  return ownerId > 0 && buyerId > 0 && ownerId !== buyerId;
}

function resolveApprovalStatusesForProgress(
  contract: ContractRow,
  input: {
    sellerStatus: ContractApprovalStatus;
    buyerStatus: ContractApprovalStatus;
  }
): {
  sellerStatus: ContractApprovalStatus;
  buyerStatus: ContractApprovalStatus;
} {
  if (isDoubleEndedDeal(contract) || !shouldTreatContractAsSingleClientFlow(contract)) {
    return input;
  }

  return {
    sellerStatus: input.sellerStatus,
    buyerStatus: approvalStatusAllowsProgress(input.buyerStatus) ? input.buyerStatus : 'APPROVED',
  };
}

const CONTRACT_SELECT_BASE_SQL = `
  SELECT
    c.id,
    c.negotiation_id,
    c.property_id,
    c.status,
    c.seller_info,
    c.buyer_info,
    c.commission_data,
    c.workflow_metadata,
    c.seller_approval_status,
    c.buyer_approval_status,
    c.seller_approval_reason,
    c.buyer_approval_reason,
    c.created_at,
    c.updated_at,
    n.capturing_broker_id,
    n.selling_broker_id,
    n.buyer_client_id,
    p.title AS property_title,
    p.purpose AS property_purpose,
    p.code AS property_code,
    p.owner_id AS property_owner_id,
    COALESCE(u_owner.name, p.owner_name) AS property_owner_name,
    capture_user.name AS capturing_broker_name,
    seller_user.name AS selling_broker_name,
    capture_agency.name AS capturing_agency_name,
    NULLIF(TRIM(CONCAT_WS(', ', capture_agency.address, capture_agency.city, capture_agency.state)), '') AS capturing_agency_address,
    __RESPONSIBLE_USERS_SELECT__
  FROM contracts c
  JOIN negotiations n ON n.id = c.negotiation_id
  JOIN properties p ON p.id = c.property_id
  LEFT JOIN brokers capture_broker ON capture_broker.id = n.capturing_broker_id
  LEFT JOIN agencies capture_agency ON capture_agency.id = capture_broker.agency_id
  LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
  LEFT JOIN users u_owner ON u_owner.id = p.owner_id
  LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
`;

let negotiationResponsiblesTableCache: boolean | null = null;

async function hasNegotiationResponsiblesTable(): Promise<boolean> {
  if (negotiationResponsiblesTableCache != null) {
    return negotiationResponsiblesTableCache;
  }

  try {
    const rows = await queryContractRows<RowDataPacket>(
      `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = 'negotiation_responsibles'
        LIMIT 1
      `,
      []
    );
    negotiationResponsiblesTableCache = rows.length > 0;
  } catch {
    negotiationResponsiblesTableCache = false;
  }

  return negotiationResponsiblesTableCache;
}

async function getContractSelectSql(): Promise<string> {
  const includeResponsibles = await hasNegotiationResponsiblesTable();
  const responsibleUsersSelect = includeResponsibles
    ? `(
      SELECT GROUP_CONCAT(nr.user_id ORDER BY nr.created_at ASC, nr.id ASC SEPARATOR ',')
      FROM negotiation_responsibles nr
      WHERE nr.negotiation_id = c.negotiation_id
    ) AS responsible_user_ids`
    : 'NULL AS responsible_user_ids';

  return CONTRACT_SELECT_BASE_SQL.replace('__RESPONSIBLE_USERS_SELECT__', responsibleUsersSelect);
}

async function fetchContractById(contractId: string): Promise<ContractRow | null> {
  const contractSelectSql = await getContractSelectSql();
  const rows = await queryContractRows<ContractRow>(
    `
      ${contractSelectSql}
      WHERE c.id = ?
      LIMIT 1
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

async function fetchContractByNegotiationId(negotiationId: string): Promise<ContractRow | null> {
  const contractSelectSql = await getContractSelectSql();
  const rows = await queryContractRows<ContractRow>(
    `
      ${contractSelectSql}
      WHERE c.negotiation_id = ?
      LIMIT 1
    `,
    [negotiationId]
  );

  return rows[0] ?? null;
}

async function fetchContractByNegotiationIdForUpdate(
  tx: PoolConnection,
  negotiationId: string
): Promise<ContractRow | null> {
  const contractSelectSql = await getContractSelectSql();
  const [rows] = await tx.query<ContractRow[]>(
    `
      ${contractSelectSql}
      WHERE c.negotiation_id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [negotiationId]
  );

  return rows[0] ?? null;
}

async function fetchContractForUpdate(
  tx: PoolConnection,
  contractId: string
): Promise<ContractRow | null> {
  const contractSelectSql = await getContractSelectSql();
  const [rows] = await tx.query<ContractRow[]>(
    `
      ${contractSelectSql}
      WHERE c.id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

class ContractController {
  async listCommissions(req: Request, res: Response): Promise<Response> {
    const now = new Date();
    const monthInput = String(req.query.month ?? '').trim();
    const yearInput = String(req.query.year ?? '').trim();

    const month = monthInput ? Number(monthInput) : now.getMonth() + 1;
    const year = yearInput ? Number(yearInput) : now.getFullYear();

    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Mês inválido. Use valores entre 1 e 12.' });
    }

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'Ano inválido. Use um valor entre 2000 e 2100.' });
    }

    try {
      const rows = await queryContractRows<CommissionContractRow>(
        `
          SELECT
            c.id,
            c.negotiation_id,
            c.property_id,
            c.commission_data,
            c.updated_at,
            p.title AS property_title,
            p.code AS property_code,
            p.purpose AS property_purpose,
            (
              SELECT nd.id
              FROM negotiation_documents nd
              WHERE nd.negotiation_id = c.negotiation_id
                AND nd.type = 'other'
                AND nd.document_type = 'contrato_assinado'
              ORDER BY nd.created_at DESC, nd.id DESC
              LIMIT 1
            ) AS signed_proposal_document_id
          FROM contracts c
          JOIN properties p ON p.id = c.property_id
          WHERE c.status = 'FINALIZED'
            AND YEAR(c.updated_at) = ?
            AND MONTH(c.updated_at) = ?
          ORDER BY c.updated_at DESC, c.id DESC
        `,
        [year, month]
      );

      let totalVGV = 0;
      let totalCaptadores = 0;
      let totalVendedores = 0;
      let totalPlataforma = 0;

      const transactions = rows.flatMap((row) => {
        const commissionData = parseStoredJsonObject(row.commission_data);
        const valorVenda = readCommissionValue(commissionData, 'valorVenda');
        const comissaoCaptador = readCommissionValue(
          commissionData,
          'comissaoCaptador'
        );
        const comissaoVendedor = readCommissionValue(
          commissionData,
          'comissaoVendedor'
        );
        const taxaPlataforma = readCommissionValue(
          commissionData,
          'taxaPlataforma'
        );

        if (valorVenda <= 0) {
          return [];
        }

        totalVGV += valorVenda;
        totalCaptadores += comissaoCaptador;
        totalVendedores += comissaoVendedor;
        totalPlataforma += taxaPlataforma;

        const signedId = row.signed_proposal_document_id;
        return [{
          contractId: row.id,
          negotiationId: row.negotiation_id,
          propertyId: Number(row.property_id),
          propertyTitle: row.property_title ?? null,
          propertyCode: row.property_code ?? null,
          propertyPurpose: row.property_purpose ?? null,
          finalizedAt: toIsoString(row.updated_at),
          signedProposalDocumentId:
            signedId != null && Number.isFinite(Number(signedId)) ? Number(signedId) : null,
          signedProposalDocumentSource:
            signedId != null && Number.isFinite(Number(signedId))
              ? 'negotiation_documents'
              : null,
          commissionData: {
            valorVenda,
            comissaoCaptador,
            comissaoVendedor,
            taxaPlataforma,
          },
        }];
      });

      return res.status(200).json({
        month,
        year,
        summary: {
          totalVGV: Number(totalVGV.toFixed(2)),
          totalCaptadores: Number(totalCaptadores.toFixed(2)),
          totalVendedores: Number(totalVendedores.toFixed(2)),
          totalPlataforma: Number(totalPlataforma.toFixed(2)),
        },
        transactions,
      });
    } catch (error) {
      console.error('Erro ao listar comissões por período:', error);
      return res.status(500).json({ error: 'Falha ao listar comissões.' });
    }
  }

  async createFromApprovedNegotiation(req: Request, res: Response): Promise<Response> {
    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID da negociação inválido.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const [negotiationRows] = await tx.query<NegotiationForContractRow[]>(
        `
          SELECT
            n.id,
            n.property_id,
            n.status,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          WHERE n.id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      const negotiation = negotiationRows[0];
      if (!negotiation) {
        await tx.rollback();
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      const negotiationStatus = String(negotiation.status ?? '').toUpperCase();
      if (!ALLOWED_NEGOTIATION_STATUSES_FOR_CONTRACT.has(negotiationStatus)) {
        await tx.rollback();
        return res.status(400).json({
          error: 'A negociação precisa estar aprovada antes da criação do contrato.',
        });
      }

      const [existingRows] = await tx.query<ExistingContractRow[]>(
        `
          SELECT id, status
          FROM contracts
          WHERE negotiation_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [negotiationId]
      );

      if (existingRows.length > 0) {
        await tx.commit();
        return res.status(200).json({
          message: 'Contrato já existente para esta negociação.',
          contract: {
            id: existingRows[0].id,
            negotiationId,
            propertyId: Number(negotiation.property_id),
            status: resolveContractStatus(existingRows[0].status),
          },
        });
      }

      await tx.query(
        `
          INSERT INTO contracts (
            id,
            negotiation_id,
            property_id,
            status,
            seller_info,
            buyer_info,
            commission_data,
            seller_approval_status,
            buyer_approval_status,
            seller_approval_reason,
            buyer_approval_reason,
            created_at,
            updated_at
          ) VALUES (
            UUID(),
            ?,
            ?,
            'AWAITING_DOCS',
            NULL,
            NULL,
            NULL,
            'PENDING',
            'PENDING',
            NULL,
            NULL,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
        `,
        [negotiationId, negotiation.property_id]
      );

      const [createdRows] = await tx.query<ContractRow[]>(
        `
          SELECT
            c.id,
            c.negotiation_id,
            c.property_id,
            c.status,
            c.seller_info,
            c.buyer_info,
            c.commission_data,
            c.seller_approval_status,
            c.buyer_approval_status,
            c.seller_approval_reason,
            c.buyer_approval_reason,
            c.created_at,
            c.updated_at,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title,
            p.purpose AS property_purpose
          FROM contracts c
          JOIN negotiations n ON n.id = c.negotiation_id
          JOIN properties p ON p.id = c.property_id
          WHERE c.negotiation_id = ?
          LIMIT 1
        `,
        [negotiationId]
      );

      await tx.commit();

      return res.status(201).json({
        message: 'Contrato criado com sucesso.',
        contract: createdRows[0] ? mapContract(createdRows[0], req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao criar contrato a partir da negociação:', error);
      return res.status(500).json({ error: 'Falha ao criar contrato.' });
    } finally {
      tx.release();
    }
  }

  async listForAdmin(req: Request, res: Response): Promise<Response> {
    const statusFilter = parseContractStatusFilter(req.query.status);
    if (req.query.status != null && statusFilter == null) {
      return res.status(400).json({ error: 'Status de contrato inválido.' });
    }

    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const whereClause = statusFilter ? 'WHERE c.status = ?' : '';
    const whereParams = statusFilter ? [statusFilter] : [];

    try {
      const contractSelectSql = await getContractSelectSql();
      const countRows = await queryContractRows<RowDataPacket>(
        `
          SELECT COUNT(*) AS total
          FROM contracts c
          ${whereClause}
        `,
        whereParams
      );
      const total = Number(countRows[0]?.total ?? 0);

      const rows = await queryContractRows<ContractRow>(
        `
          ${contractSelectSql}
          ${whereClause}
          ORDER BY c.updated_at DESC, c.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [...whereParams, limit, offset]
      );

      if (rows.length === 0) {
        return res.status(200).json({
          data: [],
          total,
          page,
          limit,
        });
      }

      const negotiationIds = rows.map((row) => row.negotiation_id);
      const placeholders = negotiationIds.map(() => '?').join(', ');
      const documentRows = await queryContractRows<ContractDocumentListRow>(
        `
          SELECT id, negotiation_id, type, document_type, metadata_json, created_at
          FROM negotiation_documents
          WHERE negotiation_id IN (${placeholders})
            AND COALESCE(document_type, '') <> 'proposal'
            AND COALESCE(type, '') <> 'proposal'
          ORDER BY created_at DESC, id DESC
        `,
        negotiationIds
      );

      const documentsByNegotiation = new Map<string, AdminContractDocument[]>();
      for (const documentRow of documentRows) {
        if (isProposalDocument(documentRow)) {
          continue;
        }
        const negotiationId = String(documentRow.negotiation_id);
        const docs = documentsByNegotiation.get(negotiationId) ?? [];
        docs.push({
          ...mapDocument(documentRow),
          downloadUrl: `/negotiations/${negotiationId}/documents/${documentRow.id}/download`,
        });
        documentsByNegotiation.set(negotiationId, docs);
      }

      return res.status(200).json({
        data: rows.map((row) => ({
          ...mapContract(row, req),
          documents: documentsByNegotiation.get(row.negotiation_id) ?? [],
        })),
        total,
        page,
        limit,
      });
    } catch (error) {
      console.error('Erro ao listar contratos para admin:', error);
      return res.status(500).json({ error: 'Falha ao listar contratos.' });
    }
  }

  async listMyContracts(req: AuthRequest, res: Response): Promise<Response> {
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const statusFilter = parseContractStatusFilter(req.query.status);
    if (req.query.status != null && statusFilter == null) {
      return res.status(400).json({ error: 'Status de contrato inválido.' });
    }

    const page = Math.max(Number(req.query.page ?? 1) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const statusClause = statusFilter ? 'AND c.status = ?' : '';
    const statusParams = statusFilter ? [statusFilter] : [];

    try {
      const contractSelectSql = await getContractSelectSql();
      const countRows = await queryContractRows<RowDataPacket>(
        `
          SELECT COUNT(*) AS total
          FROM contracts c
          JOIN negotiations n ON n.id = c.negotiation_id
          WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ? OR n.buyer_client_id = ?)
            AND COALESCE(c.seller_approval_status, '') <> 'REJECTED'
            AND COALESCE(c.buyer_approval_status, '') <> 'REJECTED'
          ${statusClause}
        `,
        [userId, userId, userId, ...statusParams]
      );
      const total = Number(countRows[0]?.total ?? 0);

      const rows = await queryContractRows<ContractRow>(
        `
          ${contractSelectSql}
          WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ? OR n.buyer_client_id = ?)
            AND COALESCE(c.seller_approval_status, '') <> 'REJECTED'
            AND COALESCE(c.buyer_approval_status, '') <> 'REJECTED'
          ${statusClause}
          ORDER BY c.updated_at DESC, c.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [userId, userId, userId, ...statusParams, limit, offset]
      );

      if (rows.length === 0) {
        return res.status(200).json({
          data: [],
          total,
          page,
          limit,
        });
      }

      const negotiationIds = rows.map((row) => row.negotiation_id);
      const placeholders = negotiationIds.map(() => '?').join(', ');
      const documentRows = await queryContractRows<ContractDocumentListRow>(
        `
          SELECT id, negotiation_id, type, document_type, metadata_json, created_at
          FROM negotiation_documents
          WHERE negotiation_id IN (${placeholders})
            AND COALESCE(document_type, '') <> 'proposal'
            AND COALESCE(type, '') <> 'proposal'
          ORDER BY created_at DESC, id DESC
        `,
        negotiationIds
      );

      const documentsByNegotiation = new Map<string, ContractDocumentRow[]>();
      for (const row of documentRows) {
        const negotiationId = String(row.negotiation_id);
        const docs = documentsByNegotiation.get(negotiationId) ?? [];
        docs.push(row);
        documentsByNegotiation.set(negotiationId, docs);
      }

      return res.status(200).json({
        data: rows.map((row) => ({
          ...mapContract(row, req),
          documentProgress: buildContractDocumentProgress(
            (documentsByNegotiation.get(row.negotiation_id) ?? []).map((doc) => {
              const mapped = mapDocument(doc);
              return {
                ...mapped,
                metadata: mapped.metadata as Record<string, unknown>,
              };
            }),
            buildContractDocumentRuleContextFromRow(row)
          ),
        })),
        total,
        page,
        limit,
      });
    } catch (error) {
      console.error('Erro ao listar contratos do corretor:', error);
      return res.status(500).json({ error: 'Falha ao listar contratos.' });
    }
  }

  async transitionStatus(req: Request, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as TransitionBody;
    const direction = String(body.direction ?? '').trim().toLowerCase();
    if (direction !== 'next' && direction !== 'previous') {
      return res.status(400).json({ error: 'Direção inválida. Use next ou previous.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      const currentStatus = resolveContractStatus(contract.status);
      const currentIndex = CONTRACT_STATUS_FLOW.indexOf(currentStatus);
      if (currentIndex < 0) {
        await tx.rollback();
        return res.status(400).json({ error: 'Status atual do contrato inválido.' });
      }

      if (currentStatus === 'FINALIZED' && direction === 'previous') {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Retrocesso de contratos finalizados está bloqueado por segurança financeira.',
        });
      }

      if (currentStatus === 'AWAITING_DOCS' && direction === 'next') {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Use a avaliação por lado para avançar de AWAITING_DOCS para IN_DRAFT.',
        });
      }

      const targetIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
      if (targetIndex < 0 || targetIndex >= CONTRACT_STATUS_FLOW.length) {
        await tx.rollback();
        return res.status(400).json({
          error:
            direction === 'next'
              ? 'Contrato já está na etapa final.'
              : 'Contrato já está na primeira etapa.',
        });
      }

      const nextStatus = CONTRACT_STATUS_FLOW[targetIndex];
      const documentsToCleanup =
        direction === 'previous'
          ? await fetchDocumentsForStepBackCleanup(tx, contract, nextStatus)
          : [];

      if (nextStatus === 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Use o endpoint de finalização para concluir o contrato com validações obrigatórias.',
        });
      }

      if (nextStatus === 'AWAITING_SIGNATURES') {
        const documentCounts = await fetchContractDocumentGateCounts(tx, contract);
        if (documentCounts.draftTotal <= 0) {
          await tx.rollback();
          return res.status(400).json({
            error:
              'Transição bloqueada: anexe uma minuta válida (contrato_minuta) vinculada a este contrato antes de avançar.',
          });
        }
      }

      await tx.query(
        `
          UPDATE contracts
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [nextStatus, contractId]
      );

      if (direction === 'previous' && nextStatus === 'AWAITING_DOCS') {
        await tx.query(
          `
            UPDATE contracts
            SET
              seller_approval_status = 'PENDING',
              buyer_approval_status = 'PENDING',
              seller_approval_reason = NULL,
              buyer_approval_reason = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [contractId]
        );
      }

      if (direction === 'previous' && documentsToCleanup.length > 0) {
        const placeholders = documentsToCleanup.map(() => '?').join(', ');
        await tx.query(
          `
            DELETE FROM negotiation_documents
            WHERE id IN (${placeholders})
          `,
          documentsToCleanup.map((document) => Number(document.id))
        );
      }

      if (direction === 'previous') {
        const nextWorkflowMetadata = resetWorkflowMetadataForStepBack(
          contract.workflow_metadata
        );

        if (nextWorkflowMetadata) {
          await tx.query(
            `
              UPDATE contracts
              SET workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
            [JSON.stringify(nextWorkflowMetadata), contractId]
          );
        } else {
          await tx.query(
            `
              UPDATE contracts
              SET workflow_metadata = NULL, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `,
            [contractId]
          );
        }
      }

      const updated = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      if (direction === 'previous' && documentsToCleanup.length > 0) {
        await cleanupContractDocumentAssets(documentsToCleanup, {
          action: 'contract_step_back_cleanup',
          contractId,
          negotiationId: contract.negotiation_id,
        });
      }

      const message =
        direction === 'previous' && nextStatus === 'AWAITING_DOCS'
          ? 'Contrato atualizado para a aba de documentos pendentes.'
          : direction === 'previous' && nextStatus === 'IN_DRAFT'
            ? 'Contrato atualizado para a aba de confecção da minuta.'
            : `Contrato atualizado para ${nextStatus}.`;

      return res.status(200).json({
        message,
        contract: updated ? mapContract(updated, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao transicionar etapa do contrato:', error);
      return res.status(500).json({ error: 'Falha ao atualizar etapa do contrato.' });
    } finally {
      tx.release();
    }
  }

  async evaluateSide(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as EvaluateSideBody;
    const side = String(body.side ?? '').trim().toLowerCase();
    if (side !== 'seller' && side !== 'buyer') {
      return res.status(400).json({ error: "Lado inválido. Use 'seller' ou 'buyer'." });
    }

    const nextSideStatus = parseContractApprovalStatusInput(body.status);
    if (!nextSideStatus) {
      return res.status(400).json({
        error:
          "Status inválido. Use PENDING, APPROVED, APPROVED_WITH_RES ou REJECTED.",
      });
    }

    const reasonText = String(body.reason ?? '').trim();
    if (
      (nextSideStatus === 'APPROVED_WITH_RES' || nextSideStatus === 'REJECTED') &&
      reasonText.length < 3
    ) {
      return res.status(400).json({
        error: 'Motivo é obrigatório para aprovação com ressalvas e rejeição.',
      });
    }

    const evaluatedBy = Number(req.userId);
    const reasonPayload = normalizeApprovalReason(
      reasonText,
      Number.isFinite(evaluatedBy) ? evaluatedBy : null
    );

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'AWAITING_DOCS') {
        await tx.rollback();
        return res.status(400).json({
          error: 'A avaliação granular só é permitida em AWAITING_DOCS.',
        });
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
      if (isDoubleEndedDeal(contract)) {
        nextSellerStatus = nextSideStatus;
        nextBuyerStatus = nextSideStatus;
        nextSellerReason = sideReason;
        nextBuyerReason = sideReason;
      } else if (side === 'seller') {
        nextSellerStatus = nextSideStatus;
        nextSellerReason = sideReason;
      } else {
        nextBuyerStatus = nextSideStatus;
        nextBuyerReason = sideReason;
      }

      const targetSides: ContractDocumentSide[] = isDoubleEndedDeal(contract)
        ? ['seller', 'buyer']
        : [side as ContractDocumentSide];
      const normalizedCategoryStatus: ContractDocumentCategoryStatus =
        nextSideStatus === 'REJECTED'
          ? 'REJECTED'
          : nextSideStatus === 'PENDING'
            ? 'PENDING'
            : 'APPROVED';
      const reviewAuditEvent: ContractAuditEvent = {
        action: 'admin_side_review',
        at: new Date().toISOString(),
        by: Number.isFinite(evaluatedBy) ? evaluatedBy : null,
        role: String(req.userRole ?? '').trim().toLowerCase() || null,
        details: {
          side,
          status: nextSideStatus,
          reason: reasonText || null,
        },
      };
      for (const targetSide of targetSides) {
        const [docRows] = await tx.query<ContractDocumentRow[]>(
          `
            SELECT id, type, document_type, metadata_json, created_at
            FROM negotiation_documents
            WHERE negotiation_id = ?
              AND COALESCE(document_type, '') <> 'proposal'
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.side')) = ?
            ORDER BY id DESC
          `,
          [contract.negotiation_id, contractId, targetSide]
        );
        for (const docRow of docRows) {
          const metadata = parseStoredJsonObject(docRow.metadata_json);
          const nextMetadata = appendAuditTrailEvent(metadata, reviewAuditEvent);
          nextMetadata.categoryStatus = normalizedCategoryStatus;
          nextMetadata.reviewStatus = nextSideStatus;
          nextMetadata.reviewReason = reasonText || null;
          nextMetadata.reviewedAt = reviewAuditEvent.at;
          nextMetadata.reviewedBy = reviewAuditEvent.by;
          await tx.query(
            `
              UPDATE negotiation_documents
              SET metadata_json = CAST(? AS JSON)
              WHERE id = ?
            `,
            [JSON.stringify(nextMetadata), Number(docRow.id)]
          );
        }
      }

      const effectiveStatuses = resolveApprovalStatusesForProgress(contract, {
        sellerStatus: nextSellerStatus,
        buyerStatus: nextBuyerStatus,
      });
      const mustMoveToDraftBySide = shouldMoveToDraft(
        contract,
        effectiveStatuses.sellerStatus,
        effectiveStatuses.buyerStatus
      );
      const categoryRows = await fetchContractCategoryValidationRows(tx, contract);
      const mustMoveToDraftByCategories = hasRequiredCategoryGateApproval({
        rows: categoryRows,
        doubleEnded: isDoubleEndedDeal(contract),
        contract,
      });
      const mustMoveToDraft = mustMoveToDraftBySide && mustMoveToDraftByCategories;
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
          nextSellerStatus,
          nextBuyerStatus,
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

      const updated = await fetchContractForUpdate(tx, contractId);
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

      return res.status(200).json({
        message: 'Avaliação do lado atualizada com sucesso.',
        contract: updated ? mapContract(updated, req) : null,
        movedToDraft: mustMoveToDraft,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao avaliar lado do contrato:', error);
      return res.status(500).json({ error: 'Falha ao avaliar documentação.' });
    } finally {
      tx.release();
    }
  }

  async evaluateCategory(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as EvaluateCategoryBody;
    const side = parseDocumentSide(body.side);
    const category = normalizeContractDocumentCategory(body.category);
    const status = resolveCategoryStatus(body.status);
    const reasonText = String(body.reason ?? '').trim();
    const reasonCode = String(body.reasonCode ?? '').trim().toUpperCase();
    if (!side) {
      return res.status(400).json({ error: "Lado inválido. Use 'seller' ou 'buyer'." });
    }
    if (!category) {
      return res.status(400).json({ error: 'Categoria documental inválida.' });
    }
    if (!isContractDocumentCategoryStatus(status)) {
      return res.status(400).json({ error: 'Status categorial inválido.' });
    }
    if (status === 'REJECTED' && reasonText.length < 3) {
      return res.status(400).json({
        error: 'Motivo obrigatório para rejeição por categoria.',
      });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();
      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }
      if (resolveContractStatus(contract.status) !== 'AWAITING_DOCS') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Revisão por categoria só é permitida em AWAITING_DOCS.',
        });
      }

      const ruleContext = buildContractDocumentRuleContextFromRow(contract);
      const categoryRule = findCategoryRequirement(side, category, ruleContext);
      if (!categoryRule) {
        await tx.rollback();
        return res.status(400).json({
          error: 'Categoria inválida para o lado informado.',
        });
      }
      if (categoryRule.applicability === 'not_applicable') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Esta categoria não se aplica ao contrato atual (perfil/finalidade).',
        });
      }

      const rows = await fetchContractCategoryValidationRows(tx, contract);
      const targetDocs = rows.filter((row) => {
        const mapped = mapDocument(row);
        return mapped.side === side && mapped.documentCategory === category;
      });
      if (targetDocs.length === 0) {
        await tx.rollback();
        return res.status(404).json({
          error: 'Nenhum documento encontrado para a categoria e lado informados.',
        });
      }

      const actorId = Number(req.userId ?? 0);
      const actorRole = String(req.userRole ?? '').trim().toLowerCase() || null;
      const auditEvent: ContractAuditEvent = {
        action: 'admin_category_review',
        at: new Date().toISOString(),
        by: Number.isFinite(actorId) && actorId > 0 ? actorId : null,
        role: actorRole,
        details: {
          side,
          category,
          status,
          reason: reasonText || null,
          reasonCode: reasonCode || null,
        },
      };

      for (const row of targetDocs) {
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

      const updatedRows = await fetchContractCategoryValidationRows(tx, contract);
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
      const nextBuyerStatus = isDoubleEndedDeal(contract)
        ? nextSellerStatus
        : resolveSideApprovalFromCategoryProgress(progress.buyer);
      const effectiveStatuses = resolveApprovalStatusesForProgress(contract, {
        sellerStatus: nextSellerStatus,
        buyerStatus: nextBuyerStatus,
      });
      const mustMoveBySide = shouldMoveToDraft(
        contract,
        effectiveStatuses.sellerStatus,
        effectiveStatuses.buyerStatus
      );
      const mustMoveByCategories = hasRequiredCategoryGateApproval({
        rows: updatedRows,
        doubleEnded: isDoubleEndedDeal(contract),
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
          ? normalizeApprovalReason(reasonText, auditEvent.by)
          : parseStoredJsonObject(contract.seller_approval_reason);
      const buyerReason =
        side === 'buyer'
          ? normalizeApprovalReason(reasonText, auditEvent.by)
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
          nextSellerStatus,
          nextBuyerStatus,
          JSON.stringify(sellerReason),
          JSON.stringify(buyerReason),
          JSON.stringify(nextWorkflowMetadata),
          nextContractStatus,
          contractId,
        ]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();
      return res.status(200).json({
        message: 'Revisão por categoria atualizada com sucesso.',
        contract: updatedContract
          ? {
              ...mapContract(updatedContract, req),
              documentProgress: progress,
            }
          : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao revisar categoria documental:', error);
      return res.status(500).json({
        error: 'Falha ao revisar categoria documental.',
      });
    } finally {
      tx.release();
    }
  }

  async uploadSignedDocs(req: Request, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as UploadContractDocumentBody;
    const documentCategoryInput = normalizeContractDocumentCategory(
      body.documentCategory ?? body.document_category
    );
    const documentTypeRaw = String(
      body.documentType ?? body.document_type ?? ''
    ).trim();
    const side = parseDocumentSide(body.side);
    if (!isContractDocumentType(documentTypeRaw) || !isSignedDocumentType(documentTypeRaw)) {
      return res.status(400).json({
        error:
          "documentType inválido. Use contrato_assinado, comprovante_pagamento ou boleto_vistoria.",
      });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile?.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'Arquivo obrigatório para upload.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'AWAITING_SIGNATURES') {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Upload de contrato assinado/comprovantes só é permitido em AWAITING_SIGNATURES.',
        });
      }

      const documentId = await storeNegotiationDocumentToR2({
        executor: tx,
        negotiationId: contract.negotiation_id,
        type: 'contract',
        documentType: documentTypeRaw,
        content: uploadedFile.buffer,
        metadataJson: {
          contractId,
          side,
          originalFileName: uploadedFile.originalname ?? null,
          uploadedAt: new Date().toISOString(),
          uploadedVia: 'admin',
        },
      });

      if (documentTypeRaw.toLowerCase() === 'contrato_assinado') {
        const nextWorkflowMetadata = mergeStoredJsonObject(contract.workflow_metadata, {
          agencySignedContractReceivedAt: new Date().toISOString(),
          agencySignedContractReceivedBy: 'admin',
        });

        await tx.query(
          `
            UPDATE contracts
            SET
              workflow_metadata = CAST(? AS JSON),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [JSON.stringify(nextWorkflowMetadata), contractId]
        );
      } else {
        await tx.query(
          `
            UPDATE contracts
            SET updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [contractId]
        );
      }

      await tx.commit();

      return res.status(201).json({
        message: 'Documento assinado/comprovante enviado com sucesso.',
        readyForFinalization: true,
        document: {
          id: documentId,
          contractId,
          documentType: documentTypeRaw,
          side,
          originalFileName: uploadedFile.originalname ?? null,
        },
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao enviar documentos assinados pelo admin:', error);
      return res.status(500).json({ error: 'Falha ao enviar documento assinado.' });
    } finally {
      tx.release();
    }
  }

  async uploadDraft(req: Request, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile?.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'Arquivo PDF da minuta é obrigatório.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      const currentStatus = resolveContractStatus(contract.status);
      if (currentStatus !== 'IN_DRAFT') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos em Em Confecção podem receber minuta.',
        });
      }

      await storeNegotiationDocumentToR2({
        executor: tx,
        negotiationId: contract.negotiation_id,
        type: 'contract',
        documentType: 'contrato_minuta',
        content: uploadedFile.buffer,
        metadataJson: {
          contractId,
          originalFileName: uploadedFile.originalname ?? null,
          uploadedAt: new Date().toISOString(),
          uploadedVia: 'admin',
        },
      });

      await tx.query(
        `
          UPDATE contracts
          SET status = 'AWAITING_SIGNATURES', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      const propertyTitle =
        (contract.property_title ?? '').trim() || 'Imóvel sem título';
      const brokerRecipientIds = Array.from(
        new Set(
          [contract.capturing_broker_id, contract.selling_broker_id].filter(
            (value): value is number =>
              value != null && Number.isFinite(Number(value))
          )
        )
      );

      for (const recipientId of brokerRecipientIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Minuta pronta para assinatura',
            message: `A minuta do contrato do imóvel ${propertyTitle} está pronta para assinatura!`,
            recipientId,
            relatedEntityId: Number(contract.property_id),
            recipientRole: 'broker',
            metadata: {
              contractId,
              negotiationId: contract.negotiation_id,
              stage: 'AWAITING_SIGNATURES',
            },
          });
        } catch (notificationError) {
          console.error('Falha ao notificar corretor sobre minuta:', notificationError);
        }
      }

      return res.status(200).json({
        message: 'Minuta anexada e contrato avançado para AWAITING_SIGNATURES.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao anexar minuta do contrato:', error);
      return res.status(500).json({ error: 'Falha ao anexar minuta do contrato.' });
    } finally {
      tx.release();
    }
  }

  async finalize(req: Request, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as FinalizeBody;
    const rawCommissionData = body.commission_data ?? body.commissionData;
    let commissionData: NormalizedCommissionData;
    try {
      commissionData = normalizeCommissionData(rawCommissionData);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'commission_data inválido.';
      return res.status(400).json({ error: message });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      const currentStatus = resolveContractStatus(contract.status);
      if (currentStatus !== 'AWAITING_SIGNATURES') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos em AWAITING_SIGNATURES podem ser finalizados.',
        });
      }

      const documentCounts = await fetchContractDocumentGateCounts(tx, contract);
      const hasSignedContract = documentCounts.signedContractTotal > 0;
      const hasPaymentProof = documentCounts.paymentReceiptTotal > 0;

      if (!hasSignedContract || !hasPaymentProof) {
        const missingDocuments: string[] = [];
        if (!hasSignedContract) {
          missingDocuments.push('contrato assinado');
        }
        if (!hasPaymentProof) {
          missingDocuments.push('comprovante de pagamento');
        }
        await tx.rollback();
        return res.status(400).json({
          error:
            `Ainda falta ${missingDocuments.join(' e ')} válido${missingDocuments.length > 1 ? 's' : ''}, vinculado${missingDocuments.length > 1 ? 's' : ''} a este contrato, para finalizar.`,
        });
      }

      const normalizedPurpose = String(contract.property_purpose ?? '')
        .trim()
        .toLowerCase();
      const isRentalOnly =
        normalizedPurpose.includes('alug') &&
        !normalizedPurpose.includes('venda');
      if (!isRentalOnly) {
        const totalSplits = Number(
          (
            commissionData.comissaoCaptador +
            commissionData.comissaoVendedor +
            commissionData.taxaPlataforma
          ).toFixed(2)
        );
        if (Math.abs(totalSplits - commissionData.valorVenda) > 0.01) {
          await tx.rollback();
          return res.status(400).json({
            error:
              'Na venda, a soma de comissões e taxa precisa fechar exatamente 100% do valor.',
          });
        }
      }

      const finalStatuses = resolveFinalDealStatuses(contract.property_purpose);

      await tx.query(
        `
          UPDATE contracts
          SET
            commission_data = CAST(? AS JSON),
            status = 'FINALIZED',
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [JSON.stringify(commissionData), contractId]
      );

      await tx.query(
        `
          UPDATE negotiations
          SET status = ?
          WHERE id = ?
        `,
        [finalStatuses.negotiationStatus, contract.negotiation_id]
      );

      await tx.query(
        `
          UPDATE properties
          SET
            status = ?,
            lifecycle_status = ?
          WHERE id = ?
        `,
        [finalStatuses.propertyStatus, finalStatuses.lifecycleStatus, contract.property_id]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      return res.status(200).json({
        message: 'Contrato finalizado com sucesso.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao finalizar contrato:', error);
      return res.status(500).json({ error: 'Falha ao finalizar contrato.' });
    } finally {
      tx.release();
    }
  }

  async reopenFinalized(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos finalizados podem ser reiniciados.',
        });
      }

      const contractDocuments = await fetchDocumentsForContractScope(
        tx,
        contract,
        'linked_or_legacy'
      );

      if (contractDocuments.length > 0) {
        await tx.query(
          `
            DELETE FROM negotiation_documents
            WHERE ${buildContractDocumentDeleteWhereClause('linked_or_legacy')}
          `,
          [contract.negotiation_id, contract.id]
        );
      }

      const nextWorkflowMetadata = resetWorkflowMetadataForRestart(
        contract.workflow_metadata
      );

      if (nextWorkflowMetadata) {
        await tx.query(
          `
            UPDATE contracts
            SET
              status = 'AWAITING_DOCS',
              seller_approval_status = 'PENDING',
              buyer_approval_status = 'PENDING',
              seller_approval_reason = NULL,
              buyer_approval_reason = NULL,
              workflow_metadata = CAST(? AS JSON),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [JSON.stringify(nextWorkflowMetadata), contractId]
        );
      } else {
        await tx.query(
          `
            UPDATE contracts
            SET
              status = 'AWAITING_DOCS',
              seller_approval_status = 'PENDING',
              buyer_approval_status = 'PENDING',
              seller_approval_reason = NULL,
              buyer_approval_reason = NULL,
              workflow_metadata = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [contractId]
        );
      }

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
            status = 'negociacao',
            visibility = 'HIDDEN',
            lifecycle_status = 'AVAILABLE'
          WHERE id = ?
        `,
        [contract.property_id]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      const cleanupStats = await cleanupContractDocumentAssets(contractDocuments, {
        action: 'reopen_finalized_contract',
        contractId,
        negotiationId: contract.negotiation_id,
      });

      logContractAdminAudit(req, 'reopen_finalized_contract', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
        deletedDocumentCount: contractDocuments.length,
        cloudinaryCleanupAttempted: cleanupStats.attempted,
        cloudinaryCleanupFailed: cleanupStats.failed,
      });

      return res.status(200).json({
        message:
          'Contrato reiniciado com sucesso. Todos os documentos vinculados foram removidos.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao reiniciar contrato finalizado:', error);
      return res.status(500).json({ error: 'Falha ao reiniciar contrato.' });
    } finally {
      tx.release();
    }
  }

  async updateCommissionData(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as UpdateCommissionDataBody;
    const rawCommissionData = body.commission_data ?? body.commissionData;
    let commissionData: NormalizedCommissionData;
    try {
      commissionData = normalizeCommissionData(rawCommissionData);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : 'commission_data inválido.',
      });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos finalizados podem ter o VGV editado.',
        });
      }

      const normalizedPurpose = String(contract.property_purpose ?? '')
        .trim()
        .toLowerCase();
      const isRentalOnly =
        normalizedPurpose.includes('alug') && !normalizedPurpose.includes('venda');
      if (!isRentalOnly) {
        const totalSplits = Number(
          (
            commissionData.comissaoCaptador +
            commissionData.comissaoVendedor +
            commissionData.taxaPlataforma
          ).toFixed(2)
        );
        if (Math.abs(totalSplits - commissionData.valorVenda) > 0.01) {
          await tx.rollback();
          return res.status(400).json({
            error:
              'Na venda, a soma de comissões e taxa precisa fechar exatamente 100% do valor.',
          });
        }
      }

      await tx.query(
        `
          UPDATE contracts
          SET commission_data = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [JSON.stringify(commissionData), contractId]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      logContractAdminAudit(req, 'update_commission_data', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
      });

      return res.status(200).json({
        message: 'VGV atualizado com sucesso.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao atualizar VGV do contrato:', error);
      return res.status(500).json({ error: 'Falha ao atualizar o VGV.' });
    } finally {
      tx.release();
    }
  }

  async deleteCommissionData(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos finalizados podem ter o VGV excluído.',
        });
      }

      await tx.query(
        `
          UPDATE contracts
          SET commission_data = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );

      await tx.commit();

      logContractAdminAudit(req, 'delete_commission_data', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
      });

      return res.status(200).json({
        message: 'VGV excluído com sucesso.',
        contractId,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao excluir VGV do contrato:', error);
      return res.status(500).json({ error: 'Falha ao excluir o VGV.' });
    } finally {
      tx.release();
    }
  }

  async uploadFinalizedDocument(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as UploadContractDocumentBody;
    const documentCategoryInput = normalizeContractDocumentCategory(
      body.documentCategory ?? body.document_category
    );
    const documentTypeRaw = String(
      body.documentType ?? body.document_type ?? ''
    ).trim();
    const normalizedDocumentType = (
      documentTypeRaw ||
      (documentCategoryInput
        ? resolveFallbackDocumentTypeByCategory(documentCategoryInput)
        : '')
    ).toLowerCase();
    const requestedSide = parseDocumentSide(body.side);
    if (!isContractDocumentType(normalizedDocumentType)) {
      return res.status(400).json({ error: 'Tipo de documento inválido.' });
    }

    if (documentTypeRequiresSide(normalizedDocumentType) && requestedSide == null) {
      return res.status(400).json({
        error: 'Informe o lado do documento (seller ou buyer) para este tipo.',
      });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile?.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'Arquivo obrigatório para upload.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos finalizados podem receber documentos nesta área.',
        });
      }

      const documentId = await storeNegotiationDocumentToR2({
        executor: tx,
        negotiationId: contract.negotiation_id,
        type: resolveDocumentStorageType(normalizedDocumentType),
        documentType: normalizedDocumentType,
        content: uploadedFile.buffer,
        metadataJson: {
          contractId,
          side: requestedSide,
          originalFileName: uploadedFile.originalname ?? null,
          uploadedBy: Number(req.userId ?? 0) || null,
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
        [contractId]
      );

      await tx.commit();

      logContractAdminAudit(req, 'upload_finalized_document', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
        documentType: normalizedDocumentType,
        side: requestedSide,
        documentId,
      });

      return res.status(201).json({
        message: 'Documento anexado com sucesso ao contrato finalizado.',
        document: {
          id: documentId,
          contractId,
          documentType: normalizedDocumentType,
          side: requestedSide,
          originalFileName: uploadedFile.originalname ?? null,
          downloadUrl: `/negotiations/${contract.negotiation_id}/documents/${documentId}/download`,
        },
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao anexar documento no contrato finalizado:', error);
      return res.status(500).json({ error: 'Falha ao anexar documento.' });
    } finally {
      tx.release();
    }
  }

  async deleteFinalizedDocument(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const documentId = Number(req.params.documentId);
    if (!Number.isFinite(documentId) || documentId <= 0) {
      return res.status(400).json({ error: 'ID do documento inválido.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos finalizados podem remover documentos nesta área.',
        });
      }

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
          WHERE id = ?
            AND ${buildContractDocumentDeleteWhereClause('linked_or_legacy')}
          LIMIT 1
          FOR UPDATE
        `,
        [documentId, contract.negotiation_id, contract.id]
      );

      const document = documentRows[0];
      if (!document) {
        await tx.rollback();
        return res.status(404).json({ error: 'Documento não encontrado para este contrato.' });
      }

      await tx.query(
        `
          DELETE FROM negotiation_documents
          WHERE id = ? AND ${buildContractDocumentDeleteWhereClause('linked_or_legacy')}
          LIMIT 1
        `,
        [documentId, contract.negotiation_id, contract.id]
      );

      await tx.query(
        `
          UPDATE contracts
          SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );

      await tx.commit();

      const cleanupStats = await cleanupContractDocumentAssets([document], {
        action: 'delete_finalized_document',
        contractId,
        negotiationId: contract.negotiation_id,
      });

      logContractAdminAudit(req, 'delete_finalized_document', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
        documentId,
        documentType: document.document_type ?? null,
        cloudinaryCleanupAttempted: cleanupStats.attempted,
        cloudinaryCleanupFailed: cleanupStats.failed,
      });

      return res.status(200).json({
        message: 'Documento removido do contrato finalizado com sucesso.',
        documentId,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao remover documento do contrato finalizado:', error);
      return res.status(500).json({ error: 'Falha ao remover documento.' });
    } finally {
      tx.release();
    }
  }

  async deleteFinalized(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (resolveContractStatus(contract.status) !== 'FINALIZED') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos finalizados podem ser excluídos nesta área.',
        });
      }

      const contractDocuments = await fetchDocumentsForContractScope(
        tx,
        contract,
        'linked_or_legacy'
      );

      if (contractDocuments.length > 0) {
        await tx.query(
          `
            DELETE FROM negotiation_documents
            WHERE ${buildContractDocumentDeleteWhereClause('linked_or_legacy')}
          `,
          [contract.negotiation_id, contract.id]
        );
      }

      await tx.query(
        `
          DELETE FROM contracts
          WHERE id = ?
          LIMIT 1
        `,
        [contractId]
      );

      await tx.commit();

      const cleanupStats = await cleanupContractDocumentAssets(contractDocuments, {
        action: 'delete_finalized_contract',
        contractId,
        negotiationId: contract.negotiation_id,
      });

      logContractAdminAudit(req, 'delete_finalized_contract', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
        deletedDocumentCount: contractDocuments.length,
        cloudinaryCleanupAttempted: cleanupStats.attempted,
        cloudinaryCleanupFailed: cleanupStats.failed,
      });

      return res.status(200).json({
        message: 'Contrato finalizado excluído com sucesso.',
        contractId,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao excluir contrato finalizado:', error);
      return res.status(500).json({ error: 'Falha ao excluir contrato finalizado.' });
    } finally {
      tx.release();
    }
  }

  async getById(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    try {
      const contract = await fetchContractById(contractId);
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (!canAccessContract(req, contract)) {
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const documents = await queryContractRows<ContractDocumentRow>(
        `
          SELECT id, type, document_type, metadata_json, created_at
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND COALESCE(document_type, '') <> 'proposal'
            AND COALESCE(type, '') <> 'proposal'
          ORDER BY created_at DESC, id DESC
        `,
        [contract.negotiation_id]
      );

      const canViewSensitiveData = canViewOwnerSensitiveData(req, contract);
      const mappedDocuments = documents
        .filter((document) => !isProposalDocument(document))
        .filter((document) => !isRejectedNegotiationDocumentRow(document))
        .map((document) => ({
          ...mapDocument(document),
          downloadUrl: `/negotiations/${contract.negotiation_id}/documents/${document.id}/download`,
        }))
        .filter((document) =>
          shouldExposeOwnerSensitiveDocument(
            {
              side: document.side,
              documentCategory: document.documentCategory,
            },
            canViewSensitiveData
          )
        );

      return res.status(200).json({
        contract: {
          ...mapContract(contract, req),
          documentProgress: buildContractDocumentProgress(
            mappedDocuments.map((document) => ({
              ...document,
              metadata: document.metadata as Record<string, unknown>,
            })),
            buildContractDocumentRuleContextFromRow(contract)
          ),
        },
        documents: mappedDocuments,
      });
    } catch (error) {
      console.error('Erro ao buscar contrato:', error);
      return res.status(500).json({ error: 'Falha ao buscar contrato.' });
    }
  }

  async downloadDocumentsZip(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    try {
      const contract = await fetchContractById(contractId);
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (!canAccessContract(req, contract)) {
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const documents = await queryContractRows<ContractDocumentDownloadRow>(
        `
          SELECT
            id,
            type,
            document_type,
            metadata_json,
            created_at,
            storage_provider,
            storage_bucket,
            storage_key,
            storage_content_type,
            storage_size_bytes,
            storage_etag
          FROM negotiation_documents
          WHERE ${buildContractDocumentDeleteWhereClause('linked_or_legacy')}
          ORDER BY created_at DESC, id DESC
        `,
        [contract.negotiation_id, contract.id]
      );

      const canViewSensitiveData = canViewOwnerSensitiveData(req, contract);
      const visibleDocuments = documents.filter((document) => {
        const mapped = mapDocument(document);
        return shouldExposeOwnerSensitiveDocument(
          {
            side: mapped.side,
            documentCategory: mapped.documentCategory,
          },
          canViewSensitiveData
        );
      });

      if (visibleDocuments.length === 0) {
        return res.status(404).json({
          error: 'Nenhum documento vinculado a este contrato foi encontrado.',
        });
      }

      const zip = new JSZip();
      for (const document of visibleDocuments) {
        const mapped = mapDocument(document);
        const fallbackName =
          mapped.originalFileName ??
          `${String(mapped.documentType ?? 'documento').trim() || 'documento'}_${mapped.id}.bin`;
        zip.file(fallbackName, await readNegotiationDocumentObject(document));
      }

      const fileNameBase =
        String(contract.property_code ?? '').trim() ||
        `contrato_${contract.id}`;
      const fileBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${fileNameBase}_documentos.zip"`
      );
      res.setHeader('Content-Length', String(fileBuffer.length));
      return res.status(200).send(fileBuffer);
    } catch (error) {
      console.error('Erro ao gerar ZIP dos documentos do contrato:', error);
      return res.status(500).json({ error: 'Falha ao gerar o arquivo ZIP.' });
    }
  }

  async getByNegotiationId(req: AuthRequest, res: Response): Promise<Response> {
    const negotiationId = String(req.params.negotiationId ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID da negociação inválido.' });
    }

    try {
      const contract = await fetchContractByNegotiationId(negotiationId);
      if (!contract) {
        return res.status(404).json({ error: 'Contrato não encontrado para esta negociação.' });
      }

      if (!canAccessContract(req, contract)) {
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const documents = await queryContractRows<ContractDocumentRow>(
        `
          SELECT id, type, document_type, metadata_json, created_at
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND COALESCE(document_type, '') <> 'proposal'
            AND COALESCE(type, '') <> 'proposal'
          ORDER BY created_at DESC, id DESC
        `,
        [contract.negotiation_id]
      );

      const canViewSensitiveData = canViewOwnerSensitiveData(req, contract);
      const mappedDocuments = documents
        .filter((document) => !isProposalDocument(document))
        .filter((document) => !isRejectedNegotiationDocumentRow(document))
        .map((document) => ({
          ...mapDocument(document),
          downloadUrl: `/negotiations/${contract.negotiation_id}/documents/${document.id}/download`,
        }))
        .filter((document) =>
          shouldExposeOwnerSensitiveDocument(
            {
              side: document.side,
              documentCategory: document.documentCategory,
            },
            canViewSensitiveData
          )
        );

      return res.status(200).json({
        contract: {
          ...mapContract(contract, req),
          documentProgress: buildContractDocumentProgress(
            mappedDocuments.map((document) => ({
              ...document,
              metadata: document.metadata as Record<string, unknown>,
            })),
            buildContractDocumentRuleContextFromRow(contract)
          ),
        },
        documents: mappedDocuments,
      });
    } catch (error) {
      console.error('Erro ao buscar contrato por negociação:', error);
      return res.status(500).json({ error: 'Falha ao buscar contrato.' });
    }
  }

  async updateSellingBrokerByNegotiation(req: AuthRequest, res: Response): Promise<Response> {
    const negotiationId = String(req.params.negotiationId ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID da negociação inválido.' });
    }

    const body = (req.body ?? {}) as {
      sameAsCapturing?: unknown;
      sellingBrokerId?: unknown;
      sellerBrokerId?: unknown;
      selling_broker_id?: unknown;
    };
    const sameAsCapturing =
      body.sameAsCapturing === true || String(body.sameAsCapturing ?? '').toLowerCase() === 'true';
    const sellingBrokerIdRaw =
      body.sellingBrokerId ?? body.sellerBrokerId ?? body.selling_broker_id;
    const userId = Number(req.userId ?? 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractByNegotiationIdForUpdate(tx, negotiationId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado para esta negociação.' });
      }

      if (!canAccessContract(req, contract)) {
        await tx.rollback();
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const capturingId = Number(contract.capturing_broker_id ?? 0);
      if (userId !== capturingId) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o corretor captador pode ajustar o responsável operacional.',
        });
      }

      const contractStatus = resolveContractStatus(contract.status);
      if (contractStatus !== 'AWAITING_DOCS' && contractStatus !== 'IN_DRAFT') {
        await tx.rollback();
        return res.status(400).json({
          error: 'O responsável operacional só pode ser alterado na fase de documentação.',
        });
      }

      if (!sameAsCapturing || sellingBrokerIdRaw != null) {
        console.warn('Ignorando configuração legada de papel secundário.', {
          negotiationId,
          userId,
          requestedSellingBrokerId: sellingBrokerIdRaw ?? null,
        });
      }

      await tx.query(
        `
          UPDATE negotiations
          SET selling_broker_id = ?, version = version + 1
          WHERE id = ?
        `,
        [capturingId, negotiationId]
      );

      await tx.commit();
    } catch (error) {
      try {
        await tx.rollback();
      } catch (rollbackError) {
        console.error('Erro ao reverter transação (responsável operacional):', rollbackError);
      }
      console.error('Erro ao atualizar responsável operacional:', error);
      return res.status(500).json({ error: 'Falha ao atualizar responsável operacional.' });
    } finally {
      tx.release();
    }

    const updated = await fetchContractByNegotiationId(negotiationId);
    return res.status(200).json({
      message: 'Responsável operacional sincronizado com o captador.',
      contract: updated ? mapContract(updated, req) : null,
    });
  }

  async setSignatureMethod(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const role = String(req.userRole ?? '').trim().toLowerCase();
    if (role === 'admin') {
      return res.status(403).json({
        error: 'Este endpoint é exclusivo para o corretor responsável pelo contrato.',
      });
    }

    const body = (req.body ?? {}) as SignatureMethodBody;
    const method = parseSignatureMethodInput(body.method);
    if (method == null) {
      return res.status(400).json({
        error: 'Método de assinatura inválido. Use method: "in_person".',
      });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (!canAccessContract(req, contract)) {
        await tx.rollback();
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      if (resolveContractStatus(contract.status) !== 'AWAITING_SIGNATURES') {
        await tx.rollback();
        return res.status(400).json({
          error:
            'A escolha do método de assinatura só pode ser feita em AWAITING_SIGNATURES.',
        });
      }

      const brokerName = resolveActingBrokerName(req, contract);
      const nextWorkflowMetadata = mergeStoredJsonObject(contract.workflow_metadata, {
        signatureMethod: method,
        signatureMethodDeclaredAt: new Date().toISOString(),
        signatureMethodDeclaredBy: Number(req.userId ?? 0) || null,
        signatureMethodDeclaredByName: brokerName,
      });

      await tx.query(
        `
          UPDATE contracts
          SET
            workflow_metadata = CAST(? AS JSON),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [JSON.stringify(nextWorkflowMetadata), contractId]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      try {
        await createAdminNotification({
          type: 'negotiation',
          title: 'Assinatura presencial informada',
          message: `O corretor ${brokerName} informou que o contrato ${contractId} será assinado presencialmente.`,
          relatedEntityId: Number(contract.property_id),
          metadata: {
            contractId,
            negotiationId: contract.negotiation_id,
            brokerId: Number(req.userId ?? 0) || null,
            method,
          },
        });
      } catch (notificationError) {
        console.error(
          'Erro ao notificar admins sobre assinatura presencial:',
          notificationError
        );
      }

      return res.status(200).json({
        message:
          'Assinatura presencial informada com sucesso. A administração foi notificada.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao registrar método de assinatura do contrato:', error);
      return res
        .status(500)
        .json({ error: 'Falha ao registrar o método de assinatura.' });
    } finally {
      tx.release();
    }
  }

  async uploadDocument(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as UploadContractDocumentBody;
    const documentCategoryInput = normalizeContractDocumentCategory(
      body.documentCategory ?? body.document_category
    );
    const documentTypeRaw = String(
      body.documentType ?? body.document_type ?? ''
    ).trim();
    const normalizedDocumentType = (
      documentTypeRaw ||
      (documentCategoryInput
        ? resolveFallbackDocumentTypeByCategory(documentCategoryInput)
        : '')
    ).toLowerCase();
    const requestedSide = parseDocumentSide(body.side);
    if (!isContractDocumentType(normalizedDocumentType)) {
      return res.status(400).json({ error: 'Tipo de documento inválido.' });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile?.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'Arquivo obrigatório para upload.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (!canAccessContract(req, contract)) {
        await tx.rollback();
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const currentStatus = resolveContractStatus(contract.status);
      const role = String(req.userRole ?? '').toLowerCase();
      const isSupplementalOther = normalizedDocumentType === 'outro';
      const isAdminSupplemental =
        role === 'admin' && isAdminSupplementalDocumentType(normalizedDocumentType);
      if (isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental) {
        if (currentStatus !== 'AWAITING_SIGNATURES') {
          await tx.rollback();
          return res.status(400).json({
            error:
              'Documentos assinados, comprovantes e anexos complementares só podem ser enviados em AWAITING_SIGNATURES.',
          });
        }
      }
      const resolvedDocumentCategory =
        documentCategoryInput ??
        resolveDocumentCategoryFromType(normalizedDocumentType);
      if (!isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental) {
        if (currentStatus !== 'AWAITING_DOCS' && currentStatus !== 'IN_DRAFT') {
          await tx.rollback();
          return res.status(400).json({
            error:
              'Categorias documentais só podem ser enviadas na etapa de documentação.',
          });
        }
        if (!resolvedDocumentCategory) {
          await tx.rollback();
          return res.status(400).json({
            error:
              'documentCategory é obrigatório para documentos da etapa AWAITING_DOCS.',
          });
        }
      }

      const doubleEnded = isDoubleEndedDeal(contract);
      const canEditSeller = canEditSellerSide(req, contract);
      const canEditBuyer = canEditBuyerSide(req, contract);

      const resolvedSide: 'seller' | 'buyer' | null = (
        isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental
      )
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
          })();

      if (
        !isSignedDocumentType(normalizedDocumentType) &&
        !isAdminSupplemental &&
        resolvedSide == null
      ) {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Informe o lado do documento (side: seller|buyer) para documentos de AWAITING_DOCS.',
        });
      }

      if (resolvedSide === 'seller' && !canEditSeller && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o proprietário pode anexar documentos do lado owner.',
        });
      }

      if (resolvedSide === 'buyer' && !canEditBuyer && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o comprador pode anexar documentos do lado buyer.',
        });
      }

      if (!isSignedDocumentType(normalizedDocumentType) && role !== 'admin') {
        const sellerStatus = resolveContractApprovalStatus(
          contract.seller_approval_status
        );
        const buyerStatus = resolveContractApprovalStatus(
          contract.buyer_approval_status
        );

        if (
          resolvedSide === 'seller' &&
          !approvalStatusAllowsEditing(sellerStatus)
        ) {
          await tx.rollback();
          return res.status(403).json({
            error: 'Documentos do lado seller não podem ser enviados após aprovação.',
          });
        }

        if (
          resolvedSide === 'buyer' &&
          !approvalStatusAllowsEditing(buyerStatus)
        ) {
          await tx.rollback();
          return res.status(403).json({
            error: 'Documentos do lado buyer não podem ser enviados após aprovação.',
          });
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
          buildContractDocumentRuleContextFromRow(contract)
        );
        if (notApplicable.blocked && !isSupplementalOther) {
          await tx.rollback();
          return res.status(422).json({
            error: 'Categoria documental não se aplica a este contrato ou lado.',
            code: 'CATEGORY_NOT_APPLICABLE',
            reasonCode: notApplicable.reasonCode,
            validationResult: {
              isValid: false,
              status: 'REJECTED',
              issues: [
                {
                  code: 'CATEGORY_NOT_APPLICABLE' as const,
                  field: 'documentCategory',
                  message:
                    'Esta categoria não é exigida para a finalidade e perfil atuais.',
                },
              ],
            },
          });
        }
      }

      const uploadValidation = validateContractDocumentUpload({
        file: {
          mimetype: uploadedFile.mimetype ?? '',
          originalname: uploadedFile.originalname ?? '',
          size: Number(uploadedFile.size ?? uploadedFile.buffer.length ?? 0),
        },
        documentType: normalizedDocumentType as ContractDocumentType,
        category: resolvedDocumentCategory,
        side: resolvedSide,
        requiresSide: !isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental,
        requiresCategory:
          !isSignedDocumentType(normalizedDocumentType) && !isAdminSupplemental,
      });
      if (!uploadValidation.isValid) {
        await tx.rollback();
        return res.status(422).json({
          error: 'Documento inválido para a categoria informada.',
          validationResult: uploadValidation,
        });
      }

      const uploadEvent: ContractAuditEvent = {
        action: 'document_upload',
        at: new Date().toISOString(),
        by: Number(req.userId ?? 0) || null,
        role: role || null,
        details: {
          side: resolvedSide,
          documentType: normalizedDocumentType,
          category: resolvedDocumentCategory,
        },
      };
      const metadataWithAudit = appendAuditTrailEvent({}, uploadEvent);
      metadataWithAudit.contractId = contractId;
      metadataWithAudit.side = resolvedSide;
      metadataWithAudit.documentCategory = resolvedDocumentCategory;
      metadataWithAudit.categoryStatus =
        isSignedDocumentType(normalizedDocumentType) || isAdminSupplemental
          ? 'APPROVED'
          : 'PENDING';
      metadataWithAudit.validationResult = uploadValidation;
      metadataWithAudit.originalFileName = uploadedFile.originalname ?? null;
      metadataWithAudit.uploadedBy = Number(req.userId ?? 0) || null;
      metadataWithAudit.uploadedAt = uploadEvent.at;

      const documentId = await storeNegotiationDocumentToR2({
        executor: tx,
        negotiationId: contract.negotiation_id,
        type: resolveDocumentStorageType(normalizedDocumentType),
        documentType: normalizedDocumentType,
        content: uploadedFile.buffer,
        metadataJson: metadataWithAudit,
      });

      const shouldMarkOnlineSignatureMethod =
        role !== 'admin' && normalizedDocumentType === 'contrato_assinado';

      const nextWorkflowMetadata = appendContractWorkflowAuditEvent(
        contract.workflow_metadata,
        uploadEvent
      );

      if (shouldMarkOnlineSignatureMethod) {
        const signatureAwareWorkflowMetadata = mergeStoredJsonObject(
          nextWorkflowMetadata,
          {
          signatureMethod: 'online',
          signedContractUploadedOnlineAt: uploadEvent.at,
          signedContractUploadedOnlineBy: Number(req.userId ?? 0) || null,
          }
        );

        await tx.query(
          `
            UPDATE contracts
            SET
              workflow_metadata = CAST(? AS JSON),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [JSON.stringify(signatureAwareWorkflowMetadata), contractId]
        );
      } else {
        await tx.query(
          `
            UPDATE contracts
            SET
              workflow_metadata = CAST(? AS JSON),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [JSON.stringify(nextWorkflowMetadata), contractId]
        );
      }

      await tx.commit();

      return res.status(201).json({
        message: 'Documento enviado com sucesso.',
        document: {
          id: documentId > 0 ? documentId : null,
          documentType: documentTypeRaw,
          documentCategory: resolvedDocumentCategory,
          side: resolvedSide,
          originalFileName: uploadedFile.originalname ?? null,
          contractId,
        },
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao enviar documento do contrato:', error);
      return res.status(500).json({ error: 'Falha ao enviar documento.' });
    } finally {
      tx.release();
    }
  }

  async deleteDocument(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const documentId = Number(req.params.documentId);
    if (!Number.isFinite(documentId) || documentId <= 0) {
      return res.status(400).json({ error: 'ID do documento inválido.' });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (!canAccessContract(req, contract)) {
        await tx.rollback();
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

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
        [documentId, contract.negotiation_id]
      );

      const document = documentRows[0];
      if (!document) {
        await tx.rollback();
        return res.status(404).json({ error: 'Documento não encontrado.' });
      }

      const metadata = parseStoredJsonObject(document.metadata_json);
      const side = parseDocumentSide(metadata.side);
      const documentType = String(document.document_type ?? '').trim().toLowerCase();
      const signedDocument = isSignedDocumentType(documentType);

      const role = String(req.userRole ?? '').toLowerCase();
      const canEditSeller = canEditSellerSide(req, contract);
      const canEditBuyer = canEditBuyerSide(req, contract);
      const doubleEnded = isDoubleEndedDeal(contract);

      if (side === 'seller' && !canEditSeller && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o proprietário pode remover documentos do lado owner.',
        });
      }

      if (side === 'buyer' && !canEditBuyer && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o comprador pode remover documentos do lado buyer.',
        });
      }

      if (!signedDocument) {
        const sellerStatus = resolveContractApprovalStatus(contract.seller_approval_status);
        const buyerStatus = resolveContractApprovalStatus(contract.buyer_approval_status);

        if (side === 'seller' && !approvalStatusAllowsEditing(sellerStatus)) {
          await tx.rollback();
          return res.status(403).json({
            error: 'Documentos do lado seller não podem ser removidos após aprovação.',
          });
        }

        if (side === 'buyer' && !approvalStatusAllowsEditing(buyerStatus)) {
          await tx.rollback();
          return res.status(403).json({
            error: 'Documentos do lado buyer não podem ser removidos após aprovação.',
          });
        }

        if (side == null) {
          const canEditAtLeastOneSide =
            approvalStatusAllowsEditing(sellerStatus) ||
            approvalStatusAllowsEditing(buyerStatus);
          if (!canEditAtLeastOneSide) {
            await tx.rollback();
            return res.status(403).json({
              error: 'Documento não pode ser removido após aprovação.',
            });
          }
        }
      }

      await tx.query(
        `
          DELETE FROM negotiation_documents
          WHERE id = ? AND negotiation_id = ?
          LIMIT 1
        `,
        [documentId, contract.negotiation_id]
      );

      await tx.query(
        `
          UPDATE contracts
          SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );

      await tx.commit();
      await cleanupContractDocumentAssets([document], {
        action: 'delete_contract_document',
        contractId,
        negotiationId: contract.negotiation_id,
      });
      return res.status(200).json({
        message: 'Documento removido com sucesso.',
        documentId,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao remover documento do contrato:', error);
      return res.status(500).json({ error: 'Falha ao remover documento.' });
    } finally {
      tx.release();
    }
  }

  async updateData(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as ContractDataBody;

    let ownerPatch: Record<string, unknown> | null = null;
    let buyerPatch: Record<string, unknown> | null = null;

    try {
      ownerPatch = normalizeJsonObject(
        body.ownerInfo ?? body.owner_info ?? body.sellerInfo ?? body.seller_info,
        'ownerInfo',
        { emptyStringAsNull: true }
      );
      buyerPatch = normalizeJsonObject(body.buyerInfo ?? body.buyer_info, 'buyerInfo', {
        emptyStringAsNull: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payload inválido.';
      return res.status(400).json({ error: message });
    }

    if (!ownerPatch && !buyerPatch) {
      return res.status(400).json({
        error: 'Informe ao menos ownerInfo ou buyerInfo para atualização.',
      });
    }

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const contract = await fetchContractForUpdate(tx, contractId);
      if (!contract) {
        await tx.rollback();
        return res.status(404).json({ error: 'Contrato não encontrado.' });
      }

      if (!canAccessContract(req, contract)) {
        await tx.rollback();
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const doubleEnded = isDoubleEndedDeal(contract);
      const role = String(req.userRole ?? '').toLowerCase();
      const isAdmin = role === 'admin';
      const canEditSeller = canEditSellerSide(req, contract);
      const canEditBuyer = canEditBuyerSide(req, contract);

      if (ownerPatch && !canEditSeller && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o proprietário pode editar ownerInfo.',
        });
      }

      if (buyerPatch && !canEditBuyer && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o comprador pode editar buyerInfo.',
        });
      }

      const sellerStatus = resolveContractApprovalStatus(
        contract.seller_approval_status
      );
      const buyerStatus = resolveContractApprovalStatus(
        contract.buyer_approval_status
      );

      if (ownerPatch && !approvalStatusAllowsEditing(sellerStatus) && !isAdmin) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Dados do lado owner não podem ser alterados após aprovação.',
        });
      }

      if (buyerPatch && !approvalStatusAllowsEditing(buyerStatus) && !isAdmin) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Dados do lado buyer não podem ser alterados após aprovação.',
        });
      }

      if (doubleEnded) {
        const userId = Number(req.userId);
        const sameBrokerId = Number(contract.capturing_broker_id ?? 0);
        if (!isAdmin && userId !== sameBrokerId) {
          await tx.rollback();
          return res.status(403).json({
            error:
              'Neste contrato de ponta dupla, apenas o corretor responsável pode editar os dois lados.',
          });
        }
      }

      const ownerInfo = parseStoredJsonObject(contract.seller_info);
      const buyerInfo = parseStoredJsonObject(contract.buyer_info);

      const nextOwnerInfo = ownerPatch ?? ownerInfo;
      const nextBuyerInfo = buyerPatch ?? buyerInfo;

      await tx.query(
        `
          UPDATE contracts
          SET
            seller_info = CAST(? AS JSON),
            buyer_info = CAST(? AS JSON),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          JSON.stringify(nextOwnerInfo),
          JSON.stringify(nextBuyerInfo),
          contractId,
        ]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      return res.status(200).json({
        message: 'Dados do contrato atualizados com sucesso.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao atualizar dados do contrato:', error);
      return res.status(500).json({ error: 'Falha ao atualizar dados do contrato.' });
    } finally {
      tx.release();
    }
  }
}

export const contractController = new ContractController();
