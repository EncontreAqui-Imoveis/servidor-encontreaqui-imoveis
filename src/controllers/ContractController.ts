import { Request, Response } from 'express';
import { RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import { deleteCloudinaryAsset, optimizeCloudinaryImageUrl } from '../config/cloudinary';
import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import { hydrateCpfFieldsInJson, resolveStoredCpf } from '../security/personalDataProtection';
import {
  createAdminNotification,
  createUserNotification,
} from '../services/notificationService';
import {
  getContractDbConnection,
  queryContractRows,
} from '../services/contractPersistenceService';
import { listCommissionSummary } from '../services/contractCommissionService';
import {
  isInvalidNegotiationDocumentContentError,
  readNegotiationDocumentObject,
  storeNegotiationDocumentToR2,
} from '../services/negotiationDocumentStorageService';
import {
  enqueueNegotiationDocumentDeletion,
  processNegotiationDocumentDeletionJob,
} from '../services/negotiationDocumentDeletionService';
import {
  getContractHubCounters,
  listContractsForAdmin,
  listMyContractsForUser,
} from '../services/contractListingService';
import {
  createContractFromApprovedNegotiation,
  isContractCreationError,
} from '../services/contractCreationService';
import {
  deleteContractCommissionData,
  isContractCommissionMutationError,
  updateContractCommissionData,
} from '../services/contractCommissionMutationService';
import {
  assertCommissionAllocationPolicy,
  cancelContractCommissionAllocations,
  syncContractCommissionAllocations,
} from '../services/contractCommissionAllocationService';
import {
  deleteFinalizedContractDocument,
  isContractFinalizedDocumentMutationError,
  uploadFinalizedContractDocument,
} from '../services/contractFinalizedDocumentMutationService';
import {
  deleteFinalizedContract,
  isContractFinalizedDeletionError,
} from '../services/contractFinalizedDeletionService';
import {
  isContractOperationalResponsibleError,
  updateContractOperationalResponsible,
} from '../services/contractOperationalResponsibleService';
import {
  isContractDataUpdateError,
  updateContractData,
} from '../services/contractDataUpdateService';
import {
  isContractSignatureMethodError,
  setContractSignatureMethod,
} from '../services/contractSignatureMethodService';
import {
  isContractBuyerHandshakeError,
  rejectBuyerHandshakeAssociation,
  verifyBuyerHandshakePin,
} from '../services/contractBuyerHandshakeService';
import {
  buildContractDocumentPayload,
  buildContractDocumentsZip,
} from '../services/contractDocumentService';
import {
  deleteContractDocument,
  isContractDocumentMutationError,
  uploadContractDocument,
} from '../services/contractDocumentMutationService';
import {
  isContractWorkflowError,
  transitionContractStatus,
} from '../services/contractWorkflowService';
import {
  buildContractDraftDocumentMetadata,
  ensureContractDraftGenerated,
  isCanonicalContractDraftMetadata,
  isContractDraftGenerationError,
} from '../services/contractDraftGenerationService';
import {
  evaluateContractSide,
  isContractSideReviewError,
} from '../services/contractSideReviewService';
import {
  evaluateContractCategory,
  isContractCategoryReviewError,
} from '../services/contractCategoryReviewService';
import {
  isContractDocumentReviewError,
  reviewContractDocument,
} from '../services/contractDocumentReviewService';
import {
  isContractDealType,
  isContractApprovalStatus,
  isContractDocumentCategoryStatus,
  isContractSharedDocumentType,
  isContractDocumentType,
  isContractStatus,
  type ContractApprovalStatus,
  type ContractDocumentType,
  type ContractDocumentCategoryCode,
  type ContractDocumentCategoryStatus,
  type ContractStatus,
  CONTRACT_DOCUMENT_CATEGORY_LABELS,
} from '../modules/contracts/domain/contract.types';
import {
  findCategoryRequirement,
  isUploadBlockedForNotApplicableCategory,
  resolveDocumentRequirementMatrixForContract,
  resolveDocumentRequirementsForContract,
  type ContractDocumentRuleContext,
} from '../modules/contracts/domain/contractDocumentRuleMatrix';
import {
  resolveDocumentCategoryFromType,
  resolveFallbackDocumentTypeByCategory,
  type ContractDocumentSide,
  validateContractDocumentUpload,
} from '../modules/contracts/domain/contractDocumentValidation';
import {
  getPropertyById as getPropertyByIdService,
  mapProperty as mapPropertyFromDiscovery,
} from '../services/propertyDiscoveryService';
import {
  mergeWorkflowMetadata,
  resetWorkflowMetadata,
} from '../services/contractWorkflowMetadata';
import {
  resolveContractAccessContext,
} from '../utils/contractAccessResolver';
import type { ContractAccessContext } from '../types/contractAuth';
import { resolveSellerPartyId } from '../utils/contractIdentity';

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
  'AWAITING_MINUTE_REVIEW',
  'AWAITING_SIGNATURES',
  'FINALIZED',
];

const CONTRACT_STATUS_SET = new Set<ContractStatus>(CONTRACT_STATUS_FLOW);

const APPROVAL_GRANTS_PROGRESS = new Set<ContractApprovalStatus>([
  'APPROVED',
  'APPROVED_WITH_RES',
]);

function readBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  return false;
}

interface NegotiationForContractRow extends RowDataPacket {
  id: string;
  property_id: number;
  status: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  property_title: string | null;
}

export interface ContractRow extends RowDataPacket {
  id: string;
  negotiation_id: string;
  property_id: number;
  deal_type: 'sale' | 'rent' | null;
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
  advertiser_id: number | null;
  proposer_id: number | null;
  initiator_side: 'buyer' | 'seller' | null;
  legal_buyer_user_id: number | null;
  handshake_pin: string | null;
  handshake_status: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
  handshake_attempts: number | null;
  seller_cpf: string | null;
  seller_cpf_ciphertext: string | null;
  buyer_cpf: string | null;
  client_name: string | null;
  property_title: string | null;
  property_purpose: string | null;
  property_code: string | null;
  property_image_url: string | null;
  property_owner_id: number | null;
  property_owner_name: string | null;
  property_owner_phone: string | null;
  proposal_initiator_user_id: number | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
  seller_client_name: string | null;
  proposer_name: string | null;
  buyer_client_name: string | null;
  capturing_agency_name: string | null;
  capturing_agency_address: string | null;
  responsible_user_ids: string | null;
  draft_review_revision_id?: number | null;
  draft_review_revision_number?: number | null;
  draft_review_document_id?: number | null;
  draft_review_original_file_name?: string | null;
  draft_review_created_at?: Date | string | null;
  seller_draft_review_decision?: 'CONSENTED' | 'CHANGES_REQUESTED' | null;
  seller_draft_review_reason?: string | null;
  seller_draft_review_at?: Date | string | null;
  buyer_draft_review_decision?: 'CONSENTED' | 'CHANGES_REQUESTED' | null;
  buyer_draft_review_reason?: string | null;
  buyer_draft_review_at?: Date | string | null;
}

export interface ContractDocumentRow extends RowDataPacket {
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

interface ContractDocumentAssetRow extends RowDataPacket {
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

interface ContractDocumentForDeleteRow extends RowDataPacket, ContractDocumentAssetRow {
  type: string;
}

export interface ContractDocumentListRow extends ContractDocumentRow {
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
  side?: unknown;
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
  replaceDocumentId?: unknown;
  replace_document_id?: unknown;
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
  valorBaseComissao: number;
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

export interface ContractDocumentProgressSide {
  side: ContractDocumentSide;
  categories: ContractDocumentCategoryProgressItem[];
  totals: {
    pending: number;
    submitted: number;
    approved: number;
    /** Kept as a zero-valued compatibility field. Rejected files return to pending upload. */
    rejected: number;
  };
}

export interface ContractDocumentProgressSummary {
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

export function buildContractDocumentRuleContextFromRow(
  row: ContractRow
): ContractDocumentRuleContext {
  return {
    dealType: isContractDealType(row.deal_type) ? row.deal_type : null,
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

export function toIsoString(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function resolveContractStatus(value: unknown): ContractStatus {
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

export function parseContractStatusFilter(value: unknown): ContractStatus | null {
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

type ContractApprovalProgressSummary = {
  status: 'PENDING' | 'IN_PROGRESS' | 'APPROVED' | 'APPROVED_WITH_RES' | 'REJECTED';
  label: string;
  nextStep: string;
};

function summarizeContractApprovalProgress(row: ContractRow): ContractApprovalProgressSummary {
  const sellerStatus = resolveContractApprovalStatus(row.seller_approval_status);
  const buyerStatus = resolveContractApprovalStatus(row.buyer_approval_status);
  const sellerProgress = approvalStatusAllowsProgress(sellerStatus);
  const buyerProgress = approvalStatusAllowsProgress(buyerStatus);
  const hasSellerDecision = sellerStatus !== 'PENDING';
  const hasBuyerDecision = buyerStatus !== 'PENDING';

  if (sellerStatus === 'REJECTED' || buyerStatus === 'REJECTED') {
    return {
      status: 'REJECTED',
      label: 'Rejeitado',
      nextStep: 'Aguardando correção do lado rejeitado',
    };
  }

  if (sellerProgress && buyerProgress) {
    const hasRes = sellerStatus === 'APPROVED_WITH_RES' || buyerStatus === 'APPROVED_WITH_RES';
    const nextStep =
      resolveContractStatus(row.status) === 'IN_DRAFT'
        ? 'Minuta liberada'
        : 'Aguardando liberação para minuta';
    return {
      status: hasRes ? 'APPROVED_WITH_RES' : 'APPROVED',
      label: hasRes ? 'Aprovado com ressalvas' : 'Aprovado',
      nextStep,
    };
  }

  if (sellerProgress || buyerProgress) {
    return {
      status: 'IN_PROGRESS',
      label: 'Em análise',
      nextStep: sellerProgress && !buyerProgress
        ? 'Aguardando aprovação do comprador'
        : !sellerProgress && buyerProgress
          ? 'Aguardando aprovação do captador'
          : 'Aguardando avaliação do outro lado',
    };
  }

  if (hasSellerDecision || hasBuyerDecision) {
    return {
      status: 'IN_PROGRESS',
      label: 'Em análise',
      nextStep: 'Aguardando avaliação do outro lado',
    };
  }

  return {
    status: 'PENDING',
    label: 'Pendente',
    nextStep: 'Aguardando avaliação dos dois lados',
  };
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
  const valorBaseComissao = parseNonNegativeNumber(
    payload.valorBaseComissao ?? payload.valorVenda,
    'valorBaseComissao'
  );
  if (valorBaseComissao <= 0) {
    throw new Error('valorBaseComissao deve ser maior que zero.');
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
  if (totalSplits > valorBaseComissao) {
    throw new Error(
      'Dados financeiros inconsistentes: soma de comissões e taxa não pode exceder valorBaseComissao.'
    );
  }

  return {
    valorBaseComissao,
    valorVenda: valorBaseComissao,
    comissaoCaptador,
    comissaoVendedor,
    taxaPlataforma,
  };
}

function hasSameCommissionData(
  storedValue: unknown,
  expected: NormalizedCommissionData
): boolean {
  const stored = parseStoredJsonObject(storedValue);
  const keys: Array<keyof NormalizedCommissionData> = [
    'valorBaseComissao',
    'valorVenda',
    'comissaoCaptador',
    'comissaoVendedor',
    'taxaPlataforma',
  ];

  return keys.every((key) => {
    const rawValue = Number(stored[key]);
    return Number.isFinite(rawValue) &&
      Number(rawValue.toFixed(2)) === Number(expected[key].toFixed(2));
  });
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
  const clientId = Number(contract.proposer_id ?? 0);
  const ownerId = Number(contract.advertiser_id ?? contract.property_owner_id ?? 0);
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
  return rows.filter((row) => !isRejectedNegotiationDocumentRow(row));
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

function resolveContractReadContext(
  req: AuthRequest | null,
  row: ContractRow
): ContractAccessContext | null {
  if (!req) return null;
  if (req.contractContext?.contractId === row.id) {
    return req.contractContext;
  }

  return resolveContractAccessContext(
    { id: req.userId, role: req.userRole },
    row
  );
}

function canViewOwnerSensitiveData(req: AuthRequest | null, row: ContractRow): boolean {
  const context = resolveContractReadContext(req, row);
  return context?.canReadSeller ?? false;
}

function canReadContractSide(
  context: ContractAccessContext | null,
  side: ContractDocumentSide
): boolean {
  return side === 'seller' ? Boolean(context?.canReadSeller) : Boolean(context?.canReadBuyer);
}

function restrictDocumentRequirementSide<T>(
  requirements: T[],
  context: ContractAccessContext | null,
  side: ContractDocumentSide
): T[] {
  return canReadContractSide(context, side) ? requirements : [];
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

function buildOwnerInfoFromContractRow(row: ContractRow): Record<string, unknown> {
  const fromStored = hydrateCpfFieldsInJson(
    parseStoredJsonObject(row.seller_info),
    'contracts:seller_info',
  );
  const fallback: Record<string, unknown> = { ...fromStored };
  const ownerName = String(row.property_owner_name ?? '').trim();
  const ownerPhone = String(row.property_owner_phone ?? '').trim();
  const ownerCpf = String(
    resolveStoredCpf(row.seller_cpf_ciphertext, row.seller_cpf, 'users:cpf') ?? ''
  ).trim();

  if (ownerName && !String(fallback.nome ?? fallback.name ?? '').trim()) {
    fallback.nome = ownerName;
  }
  if (ownerPhone && !String(fallback.telefone ?? fallback.phone ?? '').trim()) {
    fallback.telefone = ownerPhone;
  }
  if (ownerCpf && !String(fallback.cpf ?? '').trim()) fallback.cpf = ownerCpf;

  return fallback;
}

function buildBuyerInfoFromContractRow(row: ContractRow): Record<string, unknown> {
  const buyerInfo = hydrateCpfFieldsInJson(
    parseStoredJsonObject(row.buyer_info),
    'contracts:buyer_info',
  );
  const buyerName = String(row.client_name ?? '').trim();
  const buyerCpf = String(row.buyer_cpf ?? '').trim();
  const currentName = String(
    buyerInfo.nome ?? buyerInfo.clientName ?? buyerInfo.name ?? buyerInfo.fullName ?? ''
  ).trim();

  if (!currentName && buyerName) {
    buyerInfo.nome = buyerName;
  }
  if (buyerCpf && !String(buyerInfo.cpf ?? buyerInfo.clientCpf ?? '').trim()) {
    buyerInfo.cpf = buyerCpf;
  }
  return buyerInfo;
}

function resolveIdentityCapabilities(workflowMetadata: unknown) {
  const metadata = parseStoredJsonObject(workflowMetadata);
  const partyResolution = parseStoredJsonObject(metadata.partyResolution);
  const storedCapabilities = parseStoredJsonObject(partyResolution.identityCapabilities);
  const normalizeSide = (side: 'seller' | 'buyer') => {
    const values = parseStoredJsonObject(storedCapabilities[side]);
    return {
      // Old contracts remain administratively correctable until they are rebuilt.
      canEditName: values.canEditName !== false,
      canEditCpf: values.canEditCpf !== false,
    };
  };

  return {
    seller: normalizeSide('seller'),
    buyer: normalizeSide('buyer'),
  };
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

export function mapContract(row: ContractRow, req: AuthRequest | null = null) {
  const readContext = resolveContractReadContext(req, row);
  const handshakeRestricted = Boolean(readContext?.requiresHandshakeVerification);
  const statusOnlyResponsible =
    readContext?.userRole === 'responsible' && readContext.canReadDocumentFiles === false;
  const matrixContext = buildContractDocumentRuleContextFromRow(row);
  const rawDocumentRequirements = resolveDocumentRequirementsForContract(matrixContext);
  const documentRequirements = {
    seller: restrictDocumentRequirementSide(
      rawDocumentRequirements.seller.map((item) => ({
        ...item,
        label: CONTRACT_DOCUMENT_CATEGORY_LABELS[item.category],
      })),
      readContext,
      'seller'
    ),
    buyer: restrictDocumentRequirementSide(
      rawDocumentRequirements.buyer.map((item) => ({
        ...item,
        label: CONTRACT_DOCUMENT_CATEGORY_LABELS[item.category],
      })),
      readContext,
      'buyer'
    ),
  };
  const rawDocumentRequirementMatrix =
    resolveDocumentRequirementMatrixForContract(matrixContext);
  const documentRequirementMatrix = {
    seller: restrictDocumentRequirementSide(
      rawDocumentRequirementMatrix.seller.map((item) => ({
        ...item,
        label: CONTRACT_DOCUMENT_CATEGORY_LABELS[item.category],
      })),
      readContext,
      'seller'
    ),
    buyer: restrictDocumentRequirementSide(
      rawDocumentRequirementMatrix.buyer.map((item) => ({
        ...item,
        label: CONTRACT_DOCUMENT_CATEGORY_LABELS[item.category],
      })),
      readContext,
      'buyer'
    ),
  };
  const sellerInfo = buildOwnerInfoFromContractRow(row);
  const workflowMetadata = handshakeRestricted || statusOnlyResponsible
    ? {}
    : parseStoredJsonObject(row.workflow_metadata);
  const canReadSeller = canReadContractSide(readContext, 'seller');
  const canReadBuyer = canReadContractSide(readContext, 'buyer');
  const canViewSensitiveData = canReadSeller && canViewOwnerSensitiveData(req, row);
  const sellerInfoForViewer = canReadSeller && !statusOnlyResponsible
    ? redactOwnerInfoByRole(sellerInfo, canViewSensitiveData)
    : {};
  const buyerInfoForViewer = canReadBuyer && !statusOnlyResponsible
    ? buildBuyerInfoFromContractRow(row)
    : {};
  const viewerSide = resolveContractViewerSide(req, row);
  const status = resolveContractStatus(row.status);
  const draftReviewRevisionId = Number(row.draft_review_revision_id ?? 0);
  const draftReviewCanBeRead = !handshakeRestricted && !statusOnlyResponsible;
  const viewerDraftDecision = viewerSide === 'seller'
    ? row.seller_draft_review_decision ?? null
    : viewerSide === 'buyer'
      ? row.buyer_draft_review_decision ?? null
      : null;
  const viewerDraftReason = viewerSide === 'seller'
    ? row.seller_draft_review_reason ?? null
    : viewerSide === 'buyer'
      ? row.buyer_draft_review_reason ?? null
      : null;
  const bothSidesConsented =
    row.seller_draft_review_decision === 'CONSENTED' &&
    row.buyer_draft_review_decision === 'CONSENTED';
  const capabilities = readContext
    ? {
        canReadMeta: readContext.canReadMeta,
        canReadSeller: readContext.canReadSeller,
        canEditSeller: readContext.canEditSeller,
        canReadBuyer: readContext.canReadBuyer,
        canEditBuyer: readContext.canEditBuyer,
        canReadDocumentStatus: readContext.canReadDocumentStatus !== false,
        canReadDocumentFiles: readContext.canReadDocumentFiles !== false,
        canMutateDocuments:
          readContext.canMutateDocuments ??
          (!readContext.isReadOnly && (readContext.canEditSeller || readContext.canEditBuyer)),
        isReadOnly: readContext.isReadOnly,
        requiresHandshakeVerification: readContext.requiresHandshakeVerification,
      }
    : {
        canReadMeta: false,
        canReadSeller: false,
        canEditSeller: false,
        canReadBuyer: false,
        canEditBuyer: false,
        canReadDocumentStatus: false,
        canReadDocumentFiles: false,
        canMutateDocuments: false,
        isReadOnly: true,
        requiresHandshakeVerification: false,
      };
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    propertyId: Number(row.property_id),
    dealType: isContractDealType(row.deal_type) ? row.deal_type : null,
    status,
    capabilities,
    workflow: {
      status,
      isReadOnly: capabilities.isReadOnly,
    },
    handshake: {
      status: readContext?.handshakeStatus ?? null,
      requiresVerification: Boolean(readContext?.requiresHandshakeVerification),
    },
    draftReview: draftReviewCanBeRead && draftReviewRevisionId > 0
      ? {
          revisionId: draftReviewRevisionId,
          revisionNumber: Number(row.draft_review_revision_number ?? 1),
          documentId: Number(row.draft_review_document_id ?? 0) || null,
          originalFileName: row.draft_review_original_file_name ?? null,
          createdAt: row.draft_review_created_at ?? null,
          canReview:
            status === 'AWAITING_MINUTE_REVIEW' &&
            (viewerSide === 'seller' || viewerSide === 'buyer') &&
            viewerDraftDecision == null,
          viewerDecision: viewerDraftDecision,
          viewerReason: viewerDraftReason,
          sellerDecision: readContext?.userRole === 'admin' || readContext?.userRole === 'responsible'
            ? row.seller_draft_review_decision ?? null
            : viewerSide === 'seller'
              ? row.seller_draft_review_decision ?? null
              : null,
          sellerReason: readContext?.userRole === 'admin' || readContext?.userRole === 'responsible'
            ? row.seller_draft_review_reason ?? null
            : viewerSide === 'seller'
              ? row.seller_draft_review_reason ?? null
              : null,
          buyerDecision: readContext?.userRole === 'admin' || readContext?.userRole === 'responsible'
            ? row.buyer_draft_review_decision ?? null
            : viewerSide === 'buyer'
              ? row.buyer_draft_review_decision ?? null
              : null,
          buyerReason: readContext?.userRole === 'admin' || readContext?.userRole === 'responsible'
            ? row.buyer_draft_review_reason ?? null
            : viewerSide === 'buyer'
              ? row.buyer_draft_review_reason ?? null
              : null,
          allConsented: bothSidesConsented,
        }
      : null,
    sellerInfo: sellerInfoForViewer,
    // Compatibilidade legada: ownerInfo permanece somente como alias de sellerInfo.
    ownerInfo: sellerInfoForViewer,
    buyerInfo: buyerInfoForViewer,
    commissionData: canViewSensitiveData && !statusOnlyResponsible
      ? parseStoredJsonObject(row.commission_data)
      : {},
    workflowMetadata,
    identityCapabilities: statusOnlyResponsible
      ? { seller: { canEditName: false, canEditCpf: false }, buyer: { canEditName: false, canEditCpf: false } }
      : resolveIdentityCapabilities(workflowMetadata),
    sellerApprovalStatus: handshakeRestricted ? 'PENDING' : resolveContractApprovalStatus(row.seller_approval_status),
    ownerApprovalStatus: handshakeRestricted ? 'PENDING' : resolveContractApprovalStatus(row.seller_approval_status),
    buyerApprovalStatus: handshakeRestricted ? 'PENDING' : resolveContractApprovalStatus(row.buyer_approval_status),
    sellerApprovalReason: handshakeRestricted ? {} : parseStoredJsonObject(row.seller_approval_reason),
    ownerApprovalReason: handshakeRestricted ? {} : parseStoredJsonObject(row.seller_approval_reason),
    buyerApprovalReason: handshakeRestricted ? {} : parseStoredJsonObject(row.buyer_approval_reason),
    capturingBrokerId:
      !handshakeRestricted && !statusOnlyResponsible && row.capturing_broker_id !== null ? Number(row.capturing_broker_id) : null,
    sellingBrokerId:
      !handshakeRestricted && !statusOnlyResponsible && row.selling_broker_id !== null ? Number(row.selling_broker_id) : null,
    advertiserId: !handshakeRestricted && !statusOnlyResponsible && row.advertiser_id !== null ? Number(row.advertiser_id) : null,
    proposerId: !handshakeRestricted && !statusOnlyResponsible && row.proposer_id !== null ? Number(row.proposer_id) : null,
    initiatorSide: handshakeRestricted || statusOnlyResponsible ? null : row.initiator_side ?? null,
    legalBuyerUserId:
      !handshakeRestricted && !statusOnlyResponsible && row.legal_buyer_user_id !== null ? Number(row.legal_buyer_user_id) : null,
    advertiserName: handshakeRestricted || statusOnlyResponsible ? null : row.seller_client_name ?? null,
    proposerName: handshakeRestricted || statusOnlyResponsible ? null : row.proposer_name ?? row.client_name ?? null,
    clientName: handshakeRestricted || statusOnlyResponsible ? null : row.client_name ?? null,
    capturingBrokerName: handshakeRestricted || statusOnlyResponsible ? null : row.capturing_broker_name ?? null,
    sellingBrokerName: handshakeRestricted || statusOnlyResponsible ? null : row.selling_broker_name ?? null,
    ownerId: !handshakeRestricted && !statusOnlyResponsible && row.property_owner_id !== null ? Number(row.property_owner_id) : null,
    ownerName: handshakeRestricted || statusOnlyResponsible ? null : row.property_owner_name ?? null,
    propertyOwnerPhone: handshakeRestricted || statusOnlyResponsible ? null : row.property_owner_phone ?? null,
    proposalInitiatorUserId:
      !handshakeRestricted && !statusOnlyResponsible && row.proposal_initiator_user_id !== null ? Number(row.proposal_initiator_user_id) : null,
    propertyTitle: row.property_title ?? null,
    propertyCode: row.property_code ?? null,
    propertyImageUrl: optimizeCloudinaryImageUrl(row.property_image_url, { preset: 'detail' }) ?? null,
    propertyPurpose: row.property_purpose ?? null,
    agencyName: handshakeRestricted || statusOnlyResponsible ? null : row.capturing_agency_name ?? null,
    agencyAddress: handshakeRestricted || statusOnlyResponsible ? null : row.capturing_agency_address ?? null,
    sellerClientName: handshakeRestricted || statusOnlyResponsible ? null : row.seller_client_name ?? null,
    buyerClientName: handshakeRestricted || statusOnlyResponsible ? null : row.buyer_client_name ?? null,
    responsibleUserIds: handshakeRestricted || statusOnlyResponsible ? [] : parseResponsibleUserIds(row.responsible_user_ids),
    viewerSide: handshakeRestricted ? null : viewerSide,
    approvalProgress: handshakeRestricted ? { seller: null, buyer: null } : summarizeContractApprovalProgress(row),
    documentRequirements,
    documentRequirementMatrix,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

export function mapDocument(row: ContractDocumentRow) {
  const metadata = parseStoredJsonObject(row.metadata_json);
  const normalizedRowDocumentType = String(row.document_type ?? '').trim().toLowerCase();
  const isSharedArtifact =
    isContractSharedDocumentType(normalizedRowDocumentType) ||
    String(metadata.visibility ?? '').trim().toUpperCase() === 'CONTRACT_SHARED';
  const sideValue = isSharedArtifact
    ? ''
    : String(metadata.owner_side ?? metadata.side ?? '').trim().toLowerCase();
  const side: ContractDocumentSide | null =
    sideValue === 'seller' || sideValue === 'buyer'
      ? sideValue
      : null;
  const originalFileNameRaw = String(metadata.originalFileName ?? '').trim();
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
    owner_side: side,
    ownerSide: side,
    visibility: isSharedArtifact ? 'CONTRACT_SHARED' : 'SIDE_PRIVATE',
    isSharedArtifact,
    locked: isSharedArtifact || categoryStatus === 'APPROVED' || categoryStatus === 'APPROVED_WITH_RES',
    documentCategory,
    categoryStatus,
    reviewReason: reviewReason || null,
    validationResult,
    originalFileName: originalFileNameRaw || null,
    metadata,
    createdAt: toIsoString(row.created_at),
  };
}

export function buildDocumentSlots(
  requirements: ReturnType<typeof resolveDocumentRequirementMatrixForContract>,
  documents: Array<ReturnType<typeof mapDocument> & { downloadUrl: string }>
) {
  const latestBySideCategoryAndType = new Map<string, (typeof documents)[number]>();
  for (const document of documents) {
    if (!document.side || !document.documentCategory || !document.documentType) continue;
    const key = `${document.side}:${document.documentCategory}:${document.documentType}`;
    const previous = latestBySideCategoryAndType.get(key);
    const previousTime = previous?.createdAt ? new Date(previous.createdAt).getTime() : 0;
    const currentTime = document.createdAt ? new Date(document.createdAt).getTime() : 0;
    if (!previous || currentTime >= previousTime) {
      latestBySideCategoryAndType.set(key, document);
    }
  }

  return (['seller', 'buyer'] as const).flatMap((side) =>
    requirements[side]
      .filter((requirement) => requirement.applicability !== 'not_applicable')
      .flatMap((requirement) => {
        return [requirement.preferredDocumentType].map((documentType) => {
          const document = latestBySideCategoryAndType.get(
            `${side}:${requirement.category}:${documentType}`
          );
          const status = document?.categoryStatus ?? 'PENDING';
          return {
            id: document?.id ?? null,
            side,
            ownerSide: side,
            documentCategory: requirement.category,
            documentType,
            label: CONTRACT_DOCUMENT_CATEGORY_LABELS[requirement.category],
            applicability: requirement.applicability,
            required: requirement.required,
            status,
            categoryStatus: status,
            originalFileName: document?.originalFileName ?? null,
            downloadUrl: document?.downloadUrl ?? null,
          };
        });
      })
  );
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
        (item) => item.required && item.status === 'PENDING' && item.uploadedCount === 0
      ).length,
      submitted: categories.filter(
        (item) => item.required && item.status === 'PENDING' && item.uploadedCount > 0
      ).length,
      approved: categories.filter(
        (item) =>
          item.required &&
          (item.status === 'APPROVED' || item.status === 'APPROVED_WITH_RES')
      ).length,
      // A rejection deletes the file and reopens its requirement. Do not expose
      // a historical rejection counter as an active documentation state.
      rejected: 0,
    },
  };
}

export function buildContractDocumentProgress(
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
  documentSlots: ReturnType<typeof buildDocumentSlots>;
} {
  const canViewSensitiveData = canViewOwnerSensitiveData(req, row);
  const readContext = resolveContractReadContext(req, row);
  // Progress is intentionally calculated from every non-rejected document
  // before the bilateral visibility filter below. It exposes only aggregate
  // counts to the counterpart, never document names, files or private data.
  const allDocuments = documentRows
    .filter((document) => !isProposalDocument(document))
    // Rejections delete the current document. This also keeps legacy rows marked
    // as rejected out of every contract-detail representation.
    .filter((document) => !isRejectedNegotiationDocumentRow(document))
    .map((document) => ({
      ...mapDocument(document),
      downloadUrl: `/negotiations/${row.negotiation_id}/documents/${document.id}/download`,
    }));

  const documents = allDocuments
    .filter((document) =>
      document.side == null || canReadContractSide(readContext, document.side)
    )
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
  const rawRequirementMatrix = resolveDocumentRequirementMatrixForContract(matrixContext);
  const visibleRequirementMatrix = {
    seller: restrictDocumentRequirementSide(rawRequirementMatrix.seller, readContext, 'seller'),
    buyer: restrictDocumentRequirementSide(rawRequirementMatrix.buyer, readContext, 'buyer'),
  };
  const progress = buildContractDocumentProgress(
    allDocuments.map((document) => ({
      ...document,
      metadata: parseStoredJsonObject(document.metadata),
    })),
    matrixContext
  );

  return {
    ...mapContract(row, req),
    documentProgress: progress,
    documents,
    documentSlots: buildDocumentSlots(visibleRequirementMatrix, documents),
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
  document: Pick<ContractDocumentAssetRow, 'metadata_json'>
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
  documents: ContractDocumentAssetRow[],
  context: {
    action: string;
    contractId: string;
    negotiationId: string;
  }
): Promise<{ attempted: number; failed: number }> {
  let attempted = 0;
  let failed = 0;
  const tx = await getContractDbConnection();

  try {
    await tx.beginTransaction();

    for (const document of documents) {
      const hasNegotiationObject =
        String(document.storage_provider ?? '').trim().toUpperCase() === 'R2' &&
        String(document.storage_bucket ?? '').trim().length > 0 &&
        String(document.storage_key ?? '').trim().length > 0;
      const assetReference = extractCloudinaryAssetReference(document);

      if (hasNegotiationObject) {
        attempted += 1;
        try {
          await enqueueNegotiationDocumentDeletion(tx, document, {
            negotiationId: context.negotiationId,
            requestSource: context.action,
          });
        } catch (error) {
          failed += 1;
          console.error('Falha ao enfileirar exclusão R2 do documento do contrato:', {
            action: context.action,
            contractId: context.contractId,
            negotiationId: context.negotiationId,
            documentId: Number(document.id ?? 0),
            documentType: document.document_type ?? null,
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

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
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

function parseResponsibleUserIds(raw: unknown): number[] | null {
  const normalized = String(raw ?? '').trim();
  if (!normalized) {
    return null;
  }

  const ids = normalized
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  return ids.length > 0 ? Array.from(new Set(ids)) : null;
}

function resolveContractViewerSide(
  req: AuthRequest | null,
  contract: ContractRow
): 'seller' | 'buyer' | 'both' | 'none' | null {
  if (!req) {
    return null;
  }

  const context = resolveContractAccessContext(
    { id: req.userId, role: req.userRole },
    contract
  );
  if (context.userRole === 'admin' || context.userRole === 'responsible') return 'both';
  if (context.userRole === 'seller') return 'seller';
  if (context.userRole === 'buyer') return 'buyer';
  return 'none';
}

export function buildEmptyContractDocumentProgress(): ContractDocumentProgressSummary {
  const emptySide = (side: ContractDocumentSide): ContractDocumentProgressSide => ({
    side,
    categories: [],
    totals: { pending: 0, submitted: 0, approved: 0, rejected: 0 },
  });
  return { seller: emptySide('seller'), buyer: emptySide('buyer') };
}

function canAccessContract(req: AuthRequest, contract: ContractRow): boolean {
  const context = resolveContractAccessContext(
    { id: req.userId, role: req.userRole },
    contract
  );
  return context.canReadMeta;
}

function canEditSellerSide(req: AuthRequest, contract: ContractRow): boolean {
  const context = resolveContractAccessContext(
    { id: req.userId, role: req.userRole },
    contract
  );
  return context.canEditSeller;
}

function canEditBuyerSide(req: AuthRequest, contract: ContractRow): boolean {
  const context = resolveContractAccessContext(
    { id: req.userId, role: req.userRole },
    contract
  );
  return context.canEditBuyer;
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

function shouldTreatContractAsSingleClientFlow(contract: ContractRow): boolean {
  const sellerPartyId = resolveSellerPartyId(contract);
  const buyerId = Number(contract.proposer_id ?? 0);
  return sellerPartyId > 0 && buyerId > 0 && sellerPartyId !== buyerId;
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
  void contract;
  return input;
}

export const CONTRACT_SELECT_BASE_SQL = `
  SELECT
    c.id,
    c.negotiation_id,
    c.property_id,
    c.deal_type,
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
    active_draft_revision.id AS draft_review_revision_id,
    active_draft_revision.revision_number AS draft_review_revision_number,
    active_draft_revision.document_id AS draft_review_document_id,
    active_draft_revision.original_file_name AS draft_review_original_file_name,
    active_draft_revision.created_at AS draft_review_created_at,
    seller_draft_review.decision AS seller_draft_review_decision,
    seller_draft_review.reason AS seller_draft_review_reason,
    seller_draft_review.decided_at AS seller_draft_review_at,
    buyer_draft_review.decision AS buyer_draft_review_decision,
    buyer_draft_review.reason AS buyer_draft_review_reason,
    buyer_draft_review.decided_at AS buyer_draft_review_at,
    n.capturing_broker_id,
    n.selling_broker_id,
    n.advertiser_id,
    n.proposer_id,
    n.initiator_side,
    n.legal_buyer_user_id,
    n.handshake_pin,
    n.handshake_status,
    n.handshake_attempts,
    n.client_name,
    owner_user.cpf AS seller_cpf,
    owner_user.cpf_ciphertext AS seller_cpf_ciphertext,
    NULL AS buyer_cpf,
    p.title AS property_title,
    p.purpose AS property_purpose,
    COALESCE(NULLIF(TRIM(p.public_code), ''), p.code) AS property_code,
    (
      SELECT pi.image_url
      FROM property_images pi
      WHERE pi.property_id = p.id
      ORDER BY pi.id ASC
      LIMIT 1
    ) AS property_image_url,
    p.owner_id AS property_owner_id,
    COALESCE(owner_user.name, p.owner_name) AS property_owner_name,
    p.owner_phone AS property_owner_phone,
    COALESCE(
      CAST(
        NULLIF(
          JSON_UNQUOTE(
            JSON_EXTRACT(c.workflow_metadata, '$.proposalInitiatorUserId')
          ),
          ''
        ) AS UNSIGNED
      ),
      (
        SELECT MIN(npi.user_id)
        FROM negotiation_proposal_idempotency npi
        WHERE npi.negotiation_id = c.negotiation_id
      )
    ) AS proposal_initiator_user_id,
    COALESCE(property_capture_user.name, capture_user.name) AS capturing_broker_name,
    seller_user.name AS selling_broker_name,
    advertiser_user.name AS seller_client_name,
    proposer_user.name AS proposer_name,
    COALESCE(legal_buyer_user.name, NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.buyer_info, '$.nome'))), ''), proposer_user.name) AS buyer_client_name,
    capture_agency.name AS capturing_agency_name,
    NULLIF(TRIM(CONCAT_WS(', ', capture_agency.address, capture_agency.city, capture_agency.state)), '') AS capturing_agency_address,
    __RESPONSIBLE_USERS_SELECT__
  FROM contracts c
  JOIN negotiations n ON n.id = c.negotiation_id
  JOIN properties p ON p.id = c.property_id
  LEFT JOIN users property_capture_user ON property_capture_user.id = p.broker_id
  LEFT JOIN brokers capture_broker ON capture_broker.id = n.capturing_broker_id
  LEFT JOIN agencies capture_agency ON capture_agency.id = capture_broker.agency_id
  LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
  LEFT JOIN users proposer_user ON proposer_user.id = n.proposer_id
  LEFT JOIN users legal_buyer_user ON legal_buyer_user.id = n.legal_buyer_user_id
  LEFT JOIN users advertiser_user ON advertiser_user.id = n.advertiser_id
  LEFT JOIN users owner_user ON owner_user.id = p.owner_id
  LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
  LEFT JOIN contract_draft_revisions active_draft_revision
    ON active_draft_revision.contract_id = c.id
   AND active_draft_revision.is_active = 1
  LEFT JOIN contract_draft_reviews seller_draft_review
    ON seller_draft_review.revision_id = active_draft_revision.id
   AND seller_draft_review.reviewer_side = 'seller'
  LEFT JOIN contract_draft_reviews buyer_draft_review
    ON buyer_draft_review.revision_id = active_draft_revision.id
   AND buyer_draft_review.reviewer_side = 'buyer'
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
      JOIN brokers responsible_broker ON responsible_broker.id = nr.user_id
      WHERE nr.negotiation_id = c.negotiation_id
        AND responsible_broker.status = 'approved'
        AND COALESCE(responsible_broker.profile_type, 'BROKER') IN ('BROKER', 'AUXILIARY_ADMINISTRATIVE')
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
    try {
      const commissionSummary = await listCommissionSummary(req.query.month, req.query.year);
      return res.status(200).json({
        ...commissionSummary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao listar comissões.';
      if (message.includes('inválido')) {
        return res.status(400).json({ error: message });
      }
      console.error('Erro ao listar comissões por período:', error);
      return res.status(500).json({ error: 'Falha ao listar comissões.' });
    }
  }

  async createFromApprovedNegotiation(req: Request, res: Response): Promise<Response> {
    try {
      const result = await createContractFromApprovedNegotiation(req.params.id, req);
      return res.status(result.created ? 201 : 200).json({
        message: result.created
          ? 'Contrato criado com sucesso.'
          : 'Contrato já existente para esta negociação.',
        contract: mapContract(result.contract, req as AuthRequest),
        // This value is intentionally transient and is only returned by the
        // admin-only creation endpoint. It is never stored in plain text.
        handshake: result.handshakePin
          ? { status: 'PENDING', pin: result.handshakePin }
          : null,
      });
    } catch (error) {
      if (isContractCreationError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao criar contrato a partir da negociação:', error);
      return res.status(500).json({ error: 'Falha ao criar contrato.' });
    }
  }

  async listForAdmin(req: Request, res: Response): Promise<Response> {
    try {
      const payload = await listContractsForAdmin(req);
      return res.status(200).json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Status de contrato inválido')) {
        return res.status(400).json({ error: message });
      }
      console.error('Erro ao listar contratos para admin:', error);
      return res.status(500).json({ error: 'Falha ao listar contratos.' });
    }
  }

  async listMyContracts(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const payload = await listMyContractsForUser(req);
      return res.status(200).json(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Status de contrato inválido')) {
        return res.status(400).json({ error: message });
      }
      if (message.includes('Usuário não autenticado')) {
        return res.status(401).json({ error: message });
      }
      console.error('Erro ao listar contratos do corretor:', error);
      return res.status(500).json({ error: 'Falha ao listar contratos.' });
    }
  }

  async transitionStatus(req: Request, res: Response): Promise<Response> {
    try {
      const result = await transitionContractStatus({
        contractIdInput: req.params.id,
        directionInput: (req.body ?? {}).direction,
        loadContractForUpdate: fetchContractForUpdate,
      });

      return res.status(200).json({
        message: result.message,
        contract: result.contract ? mapContract(result.contract as ContractRow, req) : null,
      });
    } catch (error) {
      if (isContractWorkflowError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao transicionar etapa do contrato:', error);
      return res.status(500).json({ error: 'Falha ao atualizar etapa do contrato.' });
    }
  }

  async evaluateSide(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const result = await evaluateContractSide({
        contractIdInput: req.params.id,
        sideInput: req.body?.side,
        statusInput: req.body?.status,
        reasonInput: req.body?.reason,
        userIdInput: req.userId,
        userRoleInput: req.userRole,
        loadContractForUpdate: fetchContractForUpdate,
      });

      return res.status(200).json({
        message: result.message,
        contract: result.contract ? mapContract(result.contract, req) : null,
        movedToDraft: result.movedToDraft,
        draftGeneration: null,
      });
    } catch (error) {
      if (isContractSideReviewError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao avaliar lado do contrato:', error);
      return res.status(500).json({ error: 'Falha ao avaliar documentação.' });
    }
  }

  async evaluateCategory(req: AuthRequest, res: Response): Promise<Response> {
    try {
      const result = await evaluateContractCategory({
        contractIdInput: req.params.id,
        sideInput: req.body?.side,
        categoryInput: req.body?.category,
        statusInput: req.body?.status,
        reasonInput: req.body?.reason,
        reasonCodeInput: req.body?.reasonCode,
        userIdInput: req.userId,
        userRoleInput: req.userRole,
        loadContractForUpdate: fetchContractForUpdate,
      });

      return res.status(200).json({
        message: result.message,
        contract: result.contract ? mapContract(result.contract, req) : null,
        draftGeneration: null,
      });
    } catch (error) {
      if (isContractCategoryReviewError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao revisar categoria documental:', error);
      return res.status(500).json({
        error: 'Falha ao revisar categoria documental.',
      });
    }
  }

  async getHubCounters(req: AuthRequest, res: Response): Promise<Response> {
    try {
      return res.status(200).json(await getContractHubCounters(req));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Usuário não autenticado')) {
        return res.status(401).json({ error: message });
      }
      console.error('Erro ao calcular contadores do hub de processos:', error);
      return res.status(500).json({ error: 'Falha ao calcular contadores do hub.' });
    }
  }

  async reviewDocument(req: AuthRequest, res: Response): Promise<Response> {
    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();

      const result = await reviewContractDocument(tx, {
        contractIdInput: req.params.id,
        documentIdInput: req.params.documentId,
        statusInput: req.body?.status,
        reasonInput: req.body?.description ?? req.body?.reason,
        userIdInput: req.userId,
        userRoleInput: req.userRole,
        loadContractForUpdate: fetchContractForUpdate,
      });

      await tx.commit();

      if (result.rejectedDocument?.deletionJobId) {
        try {
          await processNegotiationDocumentDeletionJob(result.rejectedDocument.deletionJobId);
        } catch (deletionError) {
          // The job remains queued for the worker; the administrative review
          // itself was already committed and must not be reported as failed.
          console.error('Erro ao excluir imediatamente documento rejeitado:', deletionError);
        }
      }
      if (result.rejectedDocument?.uploadedByUserId) {
        const documentName =
          result.rejectedDocument.originalFileName ??
          result.rejectedDocument.documentType ??
          'enviado';
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Documento rejeitado',
            message: `O documento ${documentName} foi rejeitado. Motivo: ${String(req.body?.description ?? req.body?.reason ?? '').trim()}. Por favor, envie novamente.`,
            recipientId: result.rejectedDocument.uploadedByUserId,
            relatedEntityId: Number(result.contract?.property_id ?? 0) || null,
            metadata: {
              contractId: String(result.contract?.id ?? req.params.id),
              negotiationId: result.contract?.negotiation_id ?? null,
              propertyId: Number(result.contract?.property_id ?? 0) || null,
              documentId: result.rejectedDocument.id,
            },
            target: 'contract_details',
          });
        } catch (notifyError) {
          console.error('Erro ao notificar rejeição de documento:', notifyError);
        }
      }

      return res.status(200).json({
        message: result.message,
        contract: result.contract ? mapContract(result.contract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractDocumentReviewError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao revisar documento do contrato:', error);
      return res.status(500).json({ error: 'Falha ao revisar documento.' });
    } finally {
      tx.release();
    }
  }

  async listDocumentRejections(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const requestedPage = Number(req.query.page ?? 1);
    const requestedLimit = Number(req.query.limit ?? 25);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 100)
      : 25;
    const offset = (page - 1) * limit;

    try {
      const rows = await queryContractRows<RowDataPacket>(
        `
          SELECT
            rejection.id,
            rejection.source_document_id,
            rejection.document_type,
            rejection.document_label,
            rejection.original_file_name,
            rejection.owner_side,
            rejection.reason,
            rejection.uploaded_by_user_id,
            rejection.rejected_by_admin_id,
            rejection.rejected_at,
            reviewer.name AS rejected_by_admin_name
          FROM contract_document_rejections AS rejection
          LEFT JOIN admins AS reviewer ON reviewer.id = rejection.rejected_by_admin_id
          WHERE rejection.contract_id = ?
          ORDER BY rejection.rejected_at DESC, rejection.id DESC
          LIMIT ? OFFSET ?
        `,
        [contractId, limit, offset]
      );

      const countRows = await queryContractRows<RowDataPacket>(
        'SELECT COUNT(*) AS total FROM contract_document_rejections WHERE contract_id = ?',
        [contractId]
      );
      const total = Number(countRows[0]?.total ?? 0);

      return res.status(200).json({
        rejections: rows.map((row) => ({
          id: Number(row.id),
          sourceDocumentId: Number(row.source_document_id) || null,
          documentType: row.document_type ?? null,
          documentLabel: row.document_label ?? null,
          originalFileName: row.original_file_name ?? null,
          ownerSide: row.owner_side ?? null,
          reason: row.reason,
          uploadedByUserId: Number(row.uploaded_by_user_id) || null,
          rejectedByAdminId: Number(row.rejected_by_admin_id) || null,
          rejectedByAdminName: row.rejected_by_admin_name ?? null,
          rejectedAt: row.rejected_at,
        })),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (error) {
      console.error('Erro ao carregar histórico de rejeições do contrato:', error);
      return res.status(500).json({ error: 'Falha ao carregar histórico de rejeições.' });
    }
  }

  async uploadSignedDocs(req: AuthRequest, res: Response): Promise<Response> {
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
    const isAdminSupplementalDocumentType = documentTypeRaw.toLowerCase() === 'outro';
    if (
      !isContractDocumentType(documentTypeRaw) ||
      (!isSignedDocumentType(documentTypeRaw) && !isAdminSupplementalDocumentType)
    ) {
      return res.status(400).json({
        error:
          "documentType inválido. Use contrato_assinado, comprovante_pagamento, boleto_vistoria ou outro.",
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

      const replaceDocumentIdRaw = body.replaceDocumentId ?? body.replace_document_id;
      const replaceDocumentId = Number(replaceDocumentIdRaw);
      if (replaceDocumentIdRaw != null && (!Number.isInteger(replaceDocumentId) || replaceDocumentId <= 0)) {
        await tx.rollback();
        return res.status(400).json({ error: 'ID do documento a substituir inválido.' });
      }

      let documentToReplace: ContractDocumentAssetRow | null = null;
      if (Number.isInteger(replaceDocumentId) && replaceDocumentId > 0) {
        const [replacementRows] = await tx.query<ContractDocumentAssetRow[]>(
          `
            SELECT id, document_type, metadata_json, storage_provider, storage_bucket,
                   storage_key, storage_content_type, storage_size_bytes, storage_etag
            FROM negotiation_documents
            WHERE id = ?
              AND negotiation_id = ?
              AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
            LIMIT 1
            FOR UPDATE
          `,
          [replaceDocumentId, contract.negotiation_id, contractId]
        );
        documentToReplace = replacementRows[0] ?? null;
        if (!documentToReplace) {
          await tx.rollback();
          return res.status(404).json({ error: 'Documento a substituir não encontrado neste contrato.' });
        }
        if (String(documentToReplace.document_type ?? '').trim().toLowerCase() !== documentTypeRaw.toLowerCase()) {
          await tx.rollback();
          return res.status(400).json({ error: 'A substituição deve manter o mesmo tipo de documento.' });
        }
      }

      const documentId = await storeNegotiationDocumentToR2({
        executor: tx,
        negotiationId: contract.negotiation_id,
        type: 'contract',
        documentType: documentTypeRaw,
        content: uploadedFile.buffer,
        contentType: uploadedFile.mimetype,
        metadataJson: {
          contractId,
          // Physical documents are uploaded by the administrator for the
          // contractual process, not for either qualification dossier.
          visibility: 'CONTRACT_SHARED',
          originalFileName: uploadedFile.originalname ?? null,
          uploadedAt: new Date().toISOString(),
          uploadedVia: 'admin',
        },
      });

      if (documentToReplace) {
        await tx.query(
          'DELETE FROM negotiation_documents WHERE id = ? AND negotiation_id = ? LIMIT 1',
          [documentToReplace.id, contract.negotiation_id]
        );
      }

      if (documentTypeRaw.toLowerCase() === 'contrato_assinado') {
        const nextWorkflowMetadata = mergeWorkflowMetadata(contract.workflow_metadata, {
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

      if (documentToReplace) {
        await cleanupContractDocumentAssets([documentToReplace], {
          action: 'replace_signed_contract_document',
          contractId,
          negotiationId: contract.negotiation_id,
        });
      }

      return res.status(201).json({
        message: documentToReplace
          ? 'Documento substituído com sucesso.'
          : 'Documento assinado/comprovante enviado com sucesso.',
        readyForFinalization: true,
        document: {
          id: documentId,
          contractId,
          documentType: documentTypeRaw,
          side: null,
          owner_side: null,
          visibility: 'CONTRACT_SHARED',
          originalFileName: uploadedFile.originalname ?? null,
        },
      });
    } catch (error) {
      await tx.rollback();
      if (isInvalidNegotiationDocumentContentError(error)) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
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

    const body = (req.body ?? {}) as Record<string, unknown>;
    const reuseCurrentDraft = readBooleanLike(body.reuseCurrentDraft);
    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!reuseCurrentDraft && (!uploadedFile?.buffer || uploadedFile.buffer.length === 0)) {
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
      if (currentStatus !== 'IN_DRAFT' && currentStatus !== 'AWAITING_MINUTE_REVIEW') {
        await tx.rollback();
        return res.status(400).json({
          error: 'Somente contratos em Confecção ou Conferência da Minuta podem receber minuta.',
        });
      }

      const existingDraftDocuments = (
        await fetchDocumentsForContractScope(tx, contract, 'linked_or_legacy')
      ).filter(
        (document) =>
          String(document.document_type ?? '').trim().toLowerCase() === 'contrato_minuta'
      );

      const dealType = String(contract.deal_type ?? '').trim().toLowerCase();
      if (!isContractDealType(dealType)) {
        await tx.rollback();
        return res.status(422).json({
          error: 'Contrato sem modalidade comercial canônica; a minuta não pode ser anexada.',
        });
      }
      const activeDraftDocuments = existingDraftDocuments.filter((document) =>
        isCanonicalContractDraftMetadata(document.metadata_json, contractId, dealType)
      );

      if (reuseCurrentDraft && activeDraftDocuments.length === 0) {
        await tx.rollback();
        return res.status(400).json({
          error: 'Não há minuta canônica compatível com a modalidade atual para prosseguir.',
        });
      }

      let activeDraftDocumentId = Number(activeDraftDocuments[0]?.id ?? 0) || null;
      let activeDraftOriginalFileName = activeDraftDocuments[0]?.original_file_name ?? null;
      if (uploadedFile?.buffer && uploadedFile.buffer.length > 0) {
        activeDraftDocumentId = await storeNegotiationDocumentToR2({
          executor: tx,
          negotiationId: contract.negotiation_id,
          type: 'contract',
          documentType: 'contrato_minuta',
          content: uploadedFile.buffer,
          contentType: uploadedFile.mimetype || 'application/pdf',
          metadataJson: {
            ...buildContractDraftDocumentMetadata({
              contractId,
              dealType,
              generatedVia: 'admin_upload',
              originalFileName: uploadedFile.originalname ?? 'minuta-contrato.pdf',
              generationRevision: activeDraftDocuments.length + 1,
            }),
            // A minuta é um artefato administrativo compartilhado. Ela não
            // pertence ao dossiê pessoal de comprador ou vendedor.
            visibility: 'CONTRACT_SHARED',
            uploadedAt: new Date().toISOString(),
            uploadedVia: 'admin_upload',
          },
        });
        activeDraftOriginalFileName = uploadedFile.originalname ?? 'minuta-contrato.pdf';

        if (existingDraftDocuments.length > 0) {
          const existingDraftIds = existingDraftDocuments.map((document) => Number(document.id));
          await tx.query(
            `
              DELETE FROM negotiation_documents
              WHERE id IN (${existingDraftIds.map(() => '?').join(', ')})
            `,
            existingDraftIds
          );
        }
      }

      if (!activeDraftDocumentId) {
        await tx.rollback();
        return res.status(400).json({ error: 'Não foi possível localizar a minuta ativa.' });
      }

      const [revisionRows] = await tx.query<Array<RowDataPacket & { next_revision: number }>>(
        `
          SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision
          FROM contract_draft_revisions
          WHERE contract_id = ?
          FOR UPDATE
        `,
        [contractId]
      );
      await tx.query(
        `
          UPDATE contract_draft_revisions
          SET is_active = 0, replaced_at = CURRENT_TIMESTAMP
          WHERE contract_id = ? AND is_active = 1
        `,
        [contractId]
      );
      await tx.query(
        `
          INSERT INTO contract_draft_revisions (
            contract_id, negotiation_id, document_id, revision_number,
            original_file_name, created_by_admin_id, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, 1)
        `,
        [
          contractId,
          contract.negotiation_id,
          activeDraftDocumentId,
          Number(revisionRows[0]?.next_revision ?? 1),
          activeDraftOriginalFileName,
          Number((req as AuthRequest).userId ?? 0) || null,
        ]
      );

      await tx.query(
        `
          UPDATE contracts
          SET status = 'AWAITING_MINUTE_REVIEW', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      if (uploadedFile?.buffer && uploadedFile.buffer.length > 0 && existingDraftDocuments.length > 0) {
        const cleanupStats = await cleanupContractDocumentAssets(existingDraftDocuments, {
          action: 'replace_contract_draft',
          contractId,
          negotiationId: contract.negotiation_id,
        });
        if (cleanupStats.failed > 0) {
          console.warn('Falha ao limpar minuta anterior do contrato:', {
            contractId,
            negotiationId: contract.negotiation_id,
            attempted: cleanupStats.attempted,
            failed: cleanupStats.failed,
          });
        }
      }

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
      const sellerRecipientIds = Array.from(
        new Set(
          [
            updatedContract?.advertiser_id,
            updatedContract?.property_owner_id,
            updatedContract?.initiator_side === 'seller'
              ? updatedContract?.proposer_id
              : null,
          ].filter((value): value is number => value != null && Number.isFinite(Number(value)))
        )
      );
      const buyerRecipientIds = Array.from(
        new Set(
          [
            updatedContract?.legal_buyer_user_id,
            updatedContract?.initiator_side === 'buyer'
              ? updatedContract?.proposer_id
              : null,
          ].filter((value): value is number => value != null && Number.isFinite(Number(value)))
        )
      );

      for (const recipientId of brokerRecipientIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Minuta pronta para conferência',
            message: `A minuta do contrato do imóvel ${propertyTitle} está pronta para conferência pelas partes.`,
            recipientId,
            relatedEntityId: Number(contract.property_id),
            recipientRole: 'broker',
            metadata: {
              contractId,
              negotiationId: contract.negotiation_id,
              propertyId: Number(contract.property_id),
              stage: 'AWAITING_MINUTE_REVIEW',
            },
            target: 'contract_details',
          });
        } catch (notificationError) {
          console.error('Falha ao notificar corretor sobre minuta:', notificationError);
        }
      }

      const handshakeStatus = String(updatedContract?.handshake_status ?? '').trim().toUpperCase();
      for (const recipientId of sellerRecipientIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Minuta pronta para revisão',
            message: `A minuta do contrato do imóvel ${propertyTitle} está disponível para a sua conferência.`,
            recipientId,
            relatedEntityId: Number(contract.property_id),
            metadata: {
              contractId,
              negotiationId: contract.negotiation_id,
              propertyId: Number(contract.property_id),
            },
            target: 'contract_details',
          });
        } catch (notificationError) {
          console.error('Falha ao notificar vendedor sobre minuta:', notificationError);
        }
      }
      if (handshakeStatus !== 'REJECTED') {
        for (const recipientId of buyerRecipientIds) {
          try {
            await createUserNotification({
              type: 'negotiation',
              title: 'Minuta pronta para revisão',
              message: `A minuta do contrato do imóvel ${propertyTitle} está disponível para a sua conferência.`,
              recipientId,
              relatedEntityId: Number(contract.property_id),
              metadata: {
                contractId,
                negotiationId: contract.negotiation_id,
                propertyId: Number(contract.property_id),
              },
              target: 'contract_details',
            });
          } catch (notificationError) {
            console.error('Falha ao notificar comprador sobre minuta:', notificationError);
          }
        }
      }

      return res.status(200).json({
        message: 'Minuta anexada e enviada para conferência do comprador e vendedor.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      if (isInvalidNegotiationDocumentContentError(error)) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error('Erro ao anexar minuta do contrato:', error);
      return res.status(500).json({ error: 'Falha ao anexar minuta do contrato.' });
    } finally {
      tx.release();
    }
  }

  async reviewDraft(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    const context = req.contractContext;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const decision = String(body.decision ?? '').trim().toUpperCase();
    const reason = String(body.reason ?? '').trim().slice(0, 2000);
    if (!contractId) return res.status(400).json({ error: 'ID do contrato inválido.' });
    if (decision !== 'CONSENTED' && decision !== 'CHANGES_REQUESTED') {
      return res.status(400).json({ error: 'Decisão inválida para conferência da minuta.' });
    }
    if (decision === 'CHANGES_REQUESTED' && !reason) {
      return res.status(400).json({ error: 'Informe o motivo da solicitação de correção.' });
    }
    if (!context || (context.userRole !== 'seller' && context.userRole !== 'buyer')) {
      return res.status(403).json({ error: 'Apenas comprador ou vendedor podem conferir a minuta.' });
    }
    if (context.requiresHandshakeVerification) {
      return res.status(403).json({
        error: 'Confirme sua associação por PIN antes de conferir a minuta.',
        code: 'CONTRACT_HANDSHAKE_REQUIRED',
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
      if (resolveContractStatus(contract.status) !== 'AWAITING_MINUTE_REVIEW') {
        await tx.rollback();
        return res.status(409).json({ error: 'A minuta não está disponível para conferência nesta etapa.' });
      }
      const side = context.userRole;
      const [revisionRows] = await tx.query<Array<RowDataPacket & { id: number }>>(
        `SELECT id FROM contract_draft_revisions WHERE contract_id = ? AND is_active = 1 LIMIT 1 FOR UPDATE`,
        [contractId]
      );
      const revisionId = Number(revisionRows[0]?.id ?? 0);
      if (!revisionId) {
        await tx.rollback();
        return res.status(409).json({ error: 'A minuta ativa não possui uma revisão válida.' });
      }
      const [existingReviewRows] = await tx.query<Array<RowDataPacket & { id: number }>>(
        `
          SELECT id
          FROM contract_draft_reviews
          WHERE revision_id = ? AND reviewer_side = ?
          LIMIT 1
          FOR UPDATE
        `,
        [revisionId, side]
      );
      if (existingReviewRows.length > 0) {
        await tx.rollback();
        return res.status(409).json({
          error: 'Sua decisão para esta versão da minuta já foi registrada.',
          code: 'DRAFT_REVIEW_ALREADY_DECIDED',
        });
      }
      await tx.query(
        `
          INSERT INTO contract_draft_reviews (
            revision_id, contract_id, reviewer_user_id, reviewer_side, decision, reason, decided_at
          ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
        [revisionId, contractId, Number(req.userId), side, decision, reason || null]
      );
      const [decisionRows] = await tx.query<Array<RowDataPacket & { consent_count: number }>>(
        `
          SELECT COUNT(*) AS consent_count
          FROM contract_draft_reviews
          WHERE revision_id = ? AND decision = 'CONSENTED'
        `,
        [revisionId]
      );
      const allConsented = Number(decisionRows[0]?.consent_count ?? 0) === 2;
      if (allConsented) {
        await tx.query(
          `UPDATE contracts SET status = 'AWAITING_SIGNATURES', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [contractId]
        );
      }
      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();
      try {
        await createAdminNotification({
          type: 'negotiation',
          title: decision === 'CONSENTED' ? 'Minuta conferida' : 'Correção solicitada na minuta',
          message: decision === 'CONSENTED'
            ? `A parte ${side === 'seller' ? 'vendedora' : 'compradora'} conferiu a minuta do contrato ${contractId}.`
            : `A parte ${side === 'seller' ? 'vendedora' : 'compradora'} solicitou correção na minuta: ${reason}`,
          relatedEntityId: Number(contract.property_id),
          metadata: {
            contractId,
            negotiationId: contract.negotiation_id,
            propertyId: Number(contract.property_id),
            stage: allConsented ? 'AWAITING_SIGNATURES' : 'AWAITING_MINUTE_REVIEW',
          },
          target: 'contract_details',
        });
      } catch (notificationError) {
        console.error('Falha ao notificar administração sobre conferência da minuta:', notificationError);
      }
      return res.status(200).json({
        message: allConsented
          ? 'Os dois lados conferiram a minuta. O contrato avançou para assinaturas presenciais.'
          : decision === 'CONSENTED'
            ? 'Conferência da minuta registrada. Aguarde a outra parte.'
            : 'Solicitação de correção registrada para a administração.',
        contract: updatedContract ? mapContract(updatedContract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao registrar conferência da minuta:', error);
      return res.status(500).json({ error: 'Falha ao registrar conferência da minuta.' });
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
      if (currentStatus === 'FINALIZED') {
        if (!hasSameCommissionData(contract.commission_data, commissionData)) {
          await tx.rollback();
          return res.status(409).json({
            error: 'O contrato já foi finalizado com dados de comissão diferentes.',
            code: 'CONTRACT_ALREADY_FINALIZED_WITH_DIFFERENT_COMMISSION',
          });
        }

        await tx.rollback();
        return res.status(200).json({
          message: 'Contrato já estava finalizado.',
          contract: mapContract(contract, req),
          idempotent: true,
        });
      }

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

      try {
        assertCommissionAllocationPolicy(contract, commissionData);
      } catch (error) {
        await tx.rollback();
        return res.status(400).json({
          error:
            error instanceof Error
              ? error.message
              : 'Dados de comissão inválidos.',
        });
      }

      const finalStatuses = resolveFinalDealStatuses(contract.property_purpose);

      await tx.query(
        `
          UPDATE contracts
          SET
            commission_data = CAST(? AS JSON),
            status = 'FINALIZED',
            finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [JSON.stringify(commissionData), contractId]
      );

      await syncContractCommissionAllocations(tx, contract, commissionData);

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

      await cancelContractCommissionAllocations(tx, contractId);

      const nextWorkflowMetadata = resetWorkflowMetadata(contract.workflow_metadata);

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
              finalized_at = NULL,
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
              finalized_at = NULL,
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

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();
      const result = await updateContractCommissionData(tx, {
        req,
        contractId,
        body: req.body as UpdateCommissionDataBody,
      });

      await tx.commit();

      const contract = result.contract;
      if (contract) {
        logContractAdminAudit(req, 'update_commission_data', {
          contractId,
          negotiationId: contract.negotiation_id,
          propertyId: Number(contract.property_id),
        });
      }

      return res.status(200).json({
        message: 'VGV atualizado com sucesso.',
        contract: contract ? mapContract(contract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractCommissionMutationError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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

      const result = await deleteContractCommissionData(tx, { contractId });

      await tx.commit();

      const contract = result.contract;
      if (contract) {
        logContractAdminAudit(req, 'delete_commission_data', {
          contractId,
          negotiationId: contract.negotiation_id,
          propertyId: Number(contract.property_id),
        });
      }

      return res.status(200).json({
        message: 'VGV excluído com sucesso.',
        contractId,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractCommissionMutationError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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

      const result = await uploadFinalizedContractDocument(tx, {
        req,
        contract,
        contractId,
        body: req.body as UploadContractDocumentBody,
        uploadedFile,
      });

      await tx.commit();

      logContractAdminAudit(req, 'upload_finalized_document', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
        documentType: result.document.documentType,
        side: result.document.side,
        documentId: result.document.id,
      });

      return res.status(201).json({
        message: 'Documento anexado com sucesso ao contrato finalizado.',
        document: result.document,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractFinalizedDocumentMutationError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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

      const result = await deleteFinalizedContractDocument(tx, {
        contract,
        contractId,
        documentId,
      });

      await tx.commit();

      const cleanupStats = await cleanupContractDocumentAssets([result.document], {
        action: 'delete_finalized_document',
        contractId,
        negotiationId: contract.negotiation_id,
      });

      logContractAdminAudit(req, 'delete_finalized_document', {
        contractId,
        negotiationId: contract.negotiation_id,
        propertyId: Number(contract.property_id),
        documentId,
        documentType: result.document.document_type ?? null,
        cloudinaryCleanupAttempted: cleanupStats.attempted,
        cloudinaryCleanupFailed: cleanupStats.failed,
      });

      return res.status(200).json({
        message: 'Documento removido do contrato finalizado com sucesso.',
        documentId,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractFinalizedDocumentMutationError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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
      const result = await deleteFinalizedContract(tx, { contractId });

      await tx.commit();

      const cleanupStats = await cleanupContractDocumentAssets(result.documents, {
        action: 'delete_finalized_contract',
        contractId,
        negotiationId: result.contract.negotiation_id,
      });

      logContractAdminAudit(req, 'delete_finalized_contract', {
        contractId,
        negotiationId: result.contract.negotiation_id,
        propertyId: Number(result.contract.property_id),
        deletedDocumentCount: result.documents.length,
        cloudinaryCleanupAttempted: cleanupStats.attempted,
        cloudinaryCleanupFailed: cleanupStats.failed,
      });

      return res.status(200).json({
        message: 'Contrato finalizado excluído com sucesso.',
        contractId,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractFinalizedDeletionError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
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

      if (
        req.contractContext?.contractId !== contract.id ||
        !req.contractContext.canReadMeta
      ) {
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const payload = await buildContractDocumentPayload(contract, req);

      return res.status(200).json({
        contract: payload.contract,
        documents: payload.documents,
        documentSlots: payload.documentSlots,
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

      const context = resolveContractAccessContext(
        { id: req.userId, role: req.userRole },
        contract
      );
      if (!context.canReadMeta || !context.canReadDocumentFiles) {
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const zipPayload = await buildContractDocumentsZip(contract, req);
      if (!zipPayload) {
        return res.status(404).json({
          error: 'Nenhum documento vinculado a este contrato foi encontrado.',
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${zipPayload.fileNameBase}_documentos.zip"`
      );
      res.setHeader('Content-Length', String(zipPayload.fileBuffer.length));
      return res.status(200).send(zipPayload.fileBuffer);
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

      if (
        req.contractContext?.contractId !== contract.id ||
        !req.contractContext.canReadMeta
      ) {
        return res.status(403).json({ error: 'Acesso negado ao contrato.' });
      }

      const payload = await buildContractDocumentPayload(contract, req);

      return res.status(200).json({
        contract: {
          ...payload.contract,
        },
        documents: payload.documents,
        documentSlots: payload.documentSlots,
      });
    } catch (error) {
      console.error('Erro ao buscar contrato por negociação:', error);
      return res.status(500).json({ error: 'Falha ao buscar contrato.' });
    }
  }

  async getPropertyByNegotiationId(req: AuthRequest, res: Response): Promise<Response> {
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

      const property = await getPropertyByIdService(Number(contract.property_id), {
        publicOnly: false,
      });

      if (!property) {
        return res.status(404).json({ error: 'Imóvel não encontrado.' });
      }

      return res.status(200).json(mapPropertyFromDiscovery(property, true, 'detail'));
    } catch (error) {
      console.error('Erro ao buscar imóvel do contrato:', error);
      return res.status(500).json({ error: 'Falha ao buscar imóvel.' });
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
    let result: Awaited<ReturnType<typeof updateContractOperationalResponsible>> | null = null;
    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();
      result = await updateContractOperationalResponsible(tx, {
        req,
        negotiationId,
        body: {
          sameAsCapturing,
          sellingBrokerId: sellingBrokerIdRaw,
        },
      });
      await tx.commit();
    } catch (error) {
      try {
        await tx.rollback();
      } catch (rollbackError) {
        console.error('Erro ao reverter transação (responsável operacional):', rollbackError);
      }
      if (isContractOperationalResponsibleError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao atualizar responsável operacional:', error);
      return res.status(500).json({ error: 'Falha ao atualizar responsável operacional.' });
    } finally {
      tx.release();
    }

    return res.status(200).json({
      message: 'Responsável operacional atualizado.',
      contract: result?.contract ? mapContract(result.contract, req) : null,
    });
  }

  async generateDraft(req: Request, res: Response): Promise<Response> {
    try {
      const result = await ensureContractDraftGenerated(req.params.id, {
        forceRegenerate: readBooleanLike(req.body?.forceRegenerate),
      });
      const contract = await fetchContractById(result.contractId);
      return res.status(200).json({
        message: result.generated ? 'Minuta gerada com sucesso.' : 'Minuta canônica já estava disponível.',
        draftGeneration: result,
        contract: contract ? mapContract(contract, req) : null,
      });
    } catch (error) {
      if (isContractDraftGenerationError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao gerar minuta automática:', error);
      return res.status(500).json({ error: 'Falha ao gerar minuta automática.' });
    }
  }

  async setSignatureMethod(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
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
      const result = await setContractSignatureMethod(tx, {
        req,
        contractId,
        body: { method },
      });
      await tx.commit();

      try {
        await createAdminNotification({
          ...result.notification,
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
        contract: result.contract ? mapContract(result.contract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractSignatureMethodError(error)) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      console.error('Erro ao registrar método de assinatura do contrato:', error);
      return res
        .status(500)
        .json({ error: 'Falha ao registrar o método de assinatura.' });
    } finally {
      tx.release();
    }
  }

  async verifyBuyerHandshakePin(req: AuthRequest, res: Response): Promise<Response> {
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

      const result = await verifyBuyerHandshakePin(tx, {
        req,
        contract,
        pin: (req.body ?? {}).pin,
      });
      const updatedContract = await fetchContractForUpdate(tx, contractId);
      if (!updatedContract) {
        throw new Error('Contrato não encontrado após confirmar PIN.');
      }
      req.contractContext = resolveContractAccessContext(
        { id: req.userId, role: req.userRole },
        updatedContract
      );
      await tx.commit();

      return res.status(200).json({
        message: 'Acesso do comprador confirmado com sucesso.',
        handshake: {
          status: result.status,
          attemptsRemaining: result.attemptsRemaining,
        },
        contract: mapContract(updatedContract, req),
      });
    } catch (error) {
      if (isContractBuyerHandshakeError(error)) {
        // Invalid PIN attempts are a deliberate state transition. Persist the
        // counter (and the terminal rejection on the fifth failure) instead
        // of rolling it back with the HTTP error response.
        if (error.code === 'INVALID_HANDSHAKE_PIN' || error.code === 'CONTRACT_HANDSHAKE_LOCKED') {
          await tx.commit();
        } else {
          await tx.rollback();
        }
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          ...error.body,
        });
      }
      await tx.rollback();
      console.error('Erro ao confirmar PIN de associação do comprador:', error);
      return res.status(500).json({ error: 'Falha ao confirmar acesso do comprador.' });
    } finally {
      tx.release();
    }
  }

  async rejectBuyerHandshakeAssociation(req: AuthRequest, res: Response): Promise<Response> {
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

      const result = await rejectBuyerHandshakeAssociation(tx, { req, contract });
      await tx.commit();

      for (const recipientId of result.sellerRecipientIds) {
        try {
          await createUserNotification({
            type: 'negotiation',
            title: 'Associação de comprador recusada',
            message: 'O comprador informou que não reconhece a associação deste contrato. Revise o e-mail cadastrado.',
            recipientId,
            relatedEntityId: Number(contract.property_id),
            recipientRole: 'client',
            metadata: {
              contractId: contract.id,
              negotiationId: contract.negotiation_id,
              propertyId: Number(contract.property_id),
            },
            target: 'contract_details',
          });
        } catch (notificationError) {
          console.error('Falha ao notificar vendedor sobre associação recusada:', notificationError);
        }
      }

      return res.status(200).json({
        message: 'Associação recusada. O vendedor foi avisado para corrigir o cadastro.',
      });
    } catch (error) {
      await tx.rollback();
      if (isContractBuyerHandshakeError(error)) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code,
          ...error.body,
        });
      }
      console.error('Erro ao recusar associação do comprador:', error);
      return res.status(500).json({ error: 'Falha ao recusar associação do comprador.' });
    } finally {
      tx.release();
    }
  }

  async uploadDocument(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
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

      const result = await uploadContractDocument(tx, {
        req,
        contract,
        contractId,
        body: req.body as UploadContractDocumentBody,
        uploadedFile,
      });

      await tx.commit();

      return res.status(201).json({
        message: 'Documento enviado com sucesso.',
        document: result.document,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractDocumentMutationError(error)) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...error.body,
        });
      }
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

      const result = await deleteContractDocument(tx, {
        req,
        contract,
        contractId,
        documentId,
      });

      await tx.commit();
      await cleanupContractDocumentAssets([result.document], {
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
      if (isContractDocumentMutationError(error)) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...error.body,
        });
      }
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

    const tx = await getContractDbConnection();
    try {
      await tx.beginTransaction();
      const result = await updateContractData(tx, {
        req,
        contractId,
        body: req.body as ContractDataBody,
      });
      await tx.commit();

      return res.status(200).json({
        message: 'Dados do contrato atualizados com sucesso.',
        contract: result.contract ? mapContract(result.contract, req) : null,
      });
    } catch (error) {
      await tx.rollback();
      if (isContractDataUpdateError(error)) {
        return res.status(error.statusCode).json({
          error: error.message,
          ...error.body,
        });
      }
      console.error('Erro ao atualizar dados do contrato:', error);
      return res.status(500).json({ error: 'Falha ao atualizar dados do contrato.' });
    } finally {
      tx.release();
    }
  }
}

export const contractController = new ContractController();
