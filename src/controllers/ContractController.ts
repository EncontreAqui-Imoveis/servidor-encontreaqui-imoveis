import { Request, Response } from 'express';
import { ResultSetHeader, RowDataPacket } from 'mysql2';
import { PoolConnection } from 'mysql2/promise';

import connection from '../database/connection';
import type { AuthRequest } from '../middlewares/auth';
import { createUserNotification } from '../services/notificationService';
import {
  isContractApprovalStatus,
  isContractDocumentType,
  isContractStatus,
  type ContractApprovalStatus,
  type ContractStatus,
} from '../modules/contracts/domain/contract.types';

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
  seller_approval_status: string;
  buyer_approval_status: string;
  seller_approval_reason: unknown;
  buyer_approval_reason: unknown;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  property_title: string | null;
  property_purpose: string | null;
  property_code: string | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
}

interface ContractDocumentRow extends RowDataPacket {
  id: number;
  type: string;
  document_type: string | null;
  metadata_json: unknown;
  created_at: Date | string | null;
}

interface ContractDocumentForDeleteRow extends RowDataPacket {
  id: number;
  type: string;
  document_type: string | null;
  metadata_json: unknown;
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
  updated_at: Date | string | null;
  commission_data: unknown;
}

interface ExistingContractRow extends RowDataPacket {
  id: string;
  status: string;
}

interface ContractDataBody {
  sellerInfo?: unknown;
  seller_info?: unknown;
  buyerInfo?: unknown;
  buyer_info?: unknown;
}

interface UploadContractDocumentBody {
  documentType?: unknown;
  document_type?: unknown;
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

interface FinalizeBody {
  commission_data?: unknown;
  commissionData?: unknown;
}

interface NormalizedCommissionData {
  valorVenda: number;
  comissaoCaptador: number;
  comissaoVendedor: number;
  taxaPlataforma: number;
}

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

  return {
    valorVenda,
    comissaoCaptador: parseNonNegativeNumber(
      payload.comissaoCaptador,
      'comissaoCaptador'
    ),
    comissaoVendedor: parseNonNegativeNumber(
      payload.comissaoVendedor,
      'comissaoVendedor'
    ),
    taxaPlataforma: parseNonNegativeNumber(
      payload.taxaPlataforma,
      'taxaPlataforma'
    ),
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

function mapContract(row: ContractRow) {
  return {
    id: row.id,
    negotiationId: row.negotiation_id,
    propertyId: Number(row.property_id),
    status: resolveContractStatus(row.status),
    sellerInfo: parseStoredJsonObject(row.seller_info),
    buyerInfo: parseStoredJsonObject(row.buyer_info),
    commissionData: parseStoredJsonObject(row.commission_data),
    sellerApprovalStatus: resolveContractApprovalStatus(row.seller_approval_status),
    buyerApprovalStatus: resolveContractApprovalStatus(row.buyer_approval_status),
    sellerApprovalReason: parseStoredJsonObject(row.seller_approval_reason),
    buyerApprovalReason: parseStoredJsonObject(row.buyer_approval_reason),
    capturingBrokerId:
      row.capturing_broker_id !== null ? Number(row.capturing_broker_id) : null,
    sellingBrokerId:
      row.selling_broker_id !== null ? Number(row.selling_broker_id) : null,
    capturingBrokerName: row.capturing_broker_name ?? null,
    sellingBrokerName: row.selling_broker_name ?? null,
    propertyTitle: row.property_title ?? null,
    propertyCode: row.property_code ?? null,
    propertyPurpose: row.property_purpose ?? null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapDocument(row: ContractDocumentRow) {
  const metadata = parseStoredJsonObject(row.metadata_json);
  const sideValue = String(metadata.side ?? '').trim().toLowerCase();
  const side =
    sideValue === 'seller' || sideValue === 'buyer'
      ? sideValue
      : null;
  const originalFileNameRaw = String(metadata.originalFileName ?? '').trim();

  return {
    id: Number(row.id),
    type: row.type,
    documentType: row.document_type,
    side,
    originalFileName: originalFileNameRaw || null,
    metadata,
    createdAt: toIsoString(row.created_at),
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

type AdminContractDocument = ReturnType<typeof mapDocument> & {
  downloadUrl: string;
};

function resolveDocumentStorageType(documentType: string): 'contract' | 'other' {
  if (documentType === 'contrato_minuta' || documentType === 'contrato_assinado') {
    return 'contract';
  }
  return 'other';
}

function canAccessContract(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  if (role !== 'broker') {
    return false;
  }

  const userId = Number(req.userId);
  if (!Number.isFinite(userId) || userId <= 0) {
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
  return Number.isFinite(userId) && userId > 0 && userId === Number(contract.capturing_broker_id ?? 0);
}

function canEditBuyerSide(req: AuthRequest, contract: ContractRow): boolean {
  const role = String(req.userRole ?? '').toLowerCase();
  if (role === 'admin') {
    return true;
  }

  const userId = Number(req.userId);
  return Number.isFinite(userId) && userId > 0 && userId === Number(contract.selling_broker_id ?? 0);
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

const CONTRACT_SELECT_SQL = `
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
    p.purpose AS property_purpose,
    p.code AS property_code,
    capture_user.name AS capturing_broker_name,
    seller_user.name AS selling_broker_name
  FROM contracts c
  JOIN negotiations n ON n.id = c.negotiation_id
  JOIN properties p ON p.id = c.property_id
  LEFT JOIN users capture_user ON capture_user.id = n.capturing_broker_id
  LEFT JOIN users seller_user ON seller_user.id = n.selling_broker_id
`;

async function fetchContractById(contractId: string): Promise<ContractRow | null> {
  const [rows] = await connection.query<ContractRow[]>(
    `
      ${CONTRACT_SELECT_SQL}
      WHERE c.id = ?
      LIMIT 1
    `,
    [contractId]
  );

  return rows[0] ?? null;
}

async function fetchContractByNegotiationId(negotiationId: string): Promise<ContractRow | null> {
  const [rows] = await connection.query<ContractRow[]>(
    `
      ${CONTRACT_SELECT_SQL}
      WHERE c.negotiation_id = ?
      LIMIT 1
    `,
    [negotiationId]
  );

  return rows[0] ?? null;
}

async function fetchContractForUpdate(
  tx: PoolConnection,
  contractId: string
): Promise<ContractRow | null> {
  const [rows] = await tx.query<ContractRow[]>(
    `
      ${CONTRACT_SELECT_SQL}
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
      const [rows] = await connection.query<CommissionContractRow[]>(
        `
          SELECT
            c.id,
            c.negotiation_id,
            c.property_id,
            c.commission_data,
            c.updated_at,
            p.title AS property_title,
            p.code AS property_code
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

      const transactions = rows.map((row) => {
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

        totalVGV += valorVenda;
        totalCaptadores += comissaoCaptador;
        totalVendedores += comissaoVendedor;
        totalPlataforma += taxaPlataforma;

        return {
          contractId: row.id,
          negotiationId: row.negotiation_id,
          propertyId: Number(row.property_id),
          propertyTitle: row.property_title ?? null,
          propertyCode: row.property_code ?? null,
          finalizedAt: toIsoString(row.updated_at),
          commissionData: {
            valorVenda,
            comissaoCaptador,
            comissaoVendedor,
            taxaPlataforma,
          },
        };
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

    const tx = await connection.getConnection();
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
        contract: createdRows[0] ? mapContract(createdRows[0]) : null,
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
      const [countRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM contracts c
          ${whereClause}
        `,
        whereParams
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await connection.query<ContractRow[]>(
        `
          ${CONTRACT_SELECT_SQL}
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
      const [documentRows] = await connection.query<ContractDocumentListRow[]>(
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
          ...mapContract(row),
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
      const [countRows] = await connection.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM contracts c
          JOIN negotiations n ON n.id = c.negotiation_id
          WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ?)
          ${statusClause}
        `,
        [userId, userId, ...statusParams]
      );
      const total = Number(countRows[0]?.total ?? 0);

      const [rows] = await connection.query<ContractRow[]>(
        `
          ${CONTRACT_SELECT_SQL}
          WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ?)
          ${statusClause}
          ORDER BY c.updated_at DESC, c.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [userId, userId, ...statusParams, limit, offset]
      );

      return res.status(200).json({
        data: rows.map(mapContract),
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

    const tx = await connection.getConnection();
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

      await tx.query(
        `
          UPDATE contracts
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [nextStatus, contractId]
      );

      const updated = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      return res.status(200).json({
        message: `Contrato atualizado para ${nextStatus}.`,
        contract: updated ? mapContract(updated) : null,
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

    const tx = await connection.getConnection();
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

      const mustMoveToDraft = shouldMoveToDraft(
        contract,
        nextSellerStatus,
        nextBuyerStatus
      );
      const nextContractStatus: ContractStatus = mustMoveToDraft
        ? 'IN_DRAFT'
        : 'AWAITING_DOCS';

      await tx.query(
        `
          UPDATE contracts
          SET
            seller_approval_status = ?,
            buyer_approval_status = ?,
            seller_approval_reason = CAST(? AS JSON),
            buyer_approval_reason = CAST(? AS JSON),
            status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          nextSellerStatus,
          nextBuyerStatus,
          JSON.stringify(nextSellerReason),
          JSON.stringify(nextBuyerReason),
          nextContractStatus,
          contractId,
        ]
      );

      const updated = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      return res.status(200).json({
        message: 'Avaliação do lado atualizada com sucesso.',
        contract: updated ? mapContract(updated) : null,
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

  async uploadSignedDocs(req: Request, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as UploadContractDocumentBody;
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

    const tx = await connection.getConnection();
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

      const [insertResult] = await tx.query<ResultSetHeader>(
        `
          INSERT INTO negotiation_documents (
            negotiation_id,
            type,
            document_type,
            metadata_json,
            file_content,
            created_at
          ) VALUES (?, 'contract', ?, CAST(? AS JSON), ?, CURRENT_TIMESTAMP)
        `,
        [
          contract.negotiation_id,
          documentTypeRaw,
          JSON.stringify({
            side,
            originalFileName: uploadedFile.originalname ?? null,
            uploadedAt: new Date().toISOString(),
            uploadedVia: 'admin',
          }),
          uploadedFile.buffer,
        ]
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

      return res.status(201).json({
        message: 'Documento assinado/comprovante enviado com sucesso.',
        readyForFinalization: true,
        document: {
          id: Number(insertResult.insertId ?? 0),
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

    const tx = await connection.getConnection();
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

      await tx.query(
        `
          INSERT INTO negotiation_documents (
            negotiation_id,
            type,
            document_type,
            file_content,
            created_at
          ) VALUES (?, 'contract', 'contrato_minuta', ?, CURRENT_TIMESTAMP)
        `,
        [contract.negotiation_id, uploadedFile.buffer]
      );

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
        contract: updatedContract ? mapContract(updatedContract) : null,
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

    const tx = await connection.getConnection();
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

      const [signedDocRows] = await tx.query<RowDataPacket[]>(
        `
          SELECT COUNT(*) AS total
          FROM negotiation_documents
          WHERE negotiation_id = ?
            AND document_type IN ('contrato_assinado', 'comprovante_pagamento', 'boleto_vistoria')
        `,
        [contract.negotiation_id]
      );
      const signedDocsCount = Number(signedDocRows[0]?.total ?? 0);
      if (signedDocsCount <= 0) {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Anexe ao menos um contrato assinado ou comprovante antes de finalizar.',
        });
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
        contract: updatedContract ? mapContract(updatedContract) : null,
      });
    } catch (error) {
      await tx.rollback();
      console.error('Erro ao finalizar contrato:', error);
      return res.status(500).json({ error: 'Falha ao finalizar contrato.' });
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

      const [documents] = await connection.query<ContractDocumentRow[]>(
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

      return res.status(200).json({
        contract: mapContract(contract),
        documents: documents
          .filter((document) => !isProposalDocument(document))
          .map(mapDocument),
      });
    } catch (error) {
      console.error('Erro ao buscar contrato:', error);
      return res.status(500).json({ error: 'Falha ao buscar contrato.' });
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

      const [documents] = await connection.query<ContractDocumentRow[]>(
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

      return res.status(200).json({
        contract: mapContract(contract),
        documents: documents
          .filter((document) => !isProposalDocument(document))
          .map(mapDocument),
      });
    } catch (error) {
      console.error('Erro ao buscar contrato por negociação:', error);
      return res.status(500).json({ error: 'Falha ao buscar contrato.' });
    }
  }

  async uploadDocument(req: AuthRequest, res: Response): Promise<Response> {
    const contractId = String(req.params.id ?? '').trim();
    if (!contractId) {
      return res.status(400).json({ error: 'ID do contrato inválido.' });
    }

    const body = (req.body ?? {}) as UploadContractDocumentBody;
    const documentTypeRaw = String(
      body.documentType ?? body.document_type ?? ''
    ).trim();
    const requestedSide = parseDocumentSide(body.side);
    if (!isContractDocumentType(documentTypeRaw)) {
      return res.status(400).json({ error: 'Tipo de documento inválido.' });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile?.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'Arquivo obrigatório para upload.' });
    }

    const tx = await connection.getConnection();
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
      if (isSignedDocumentType(documentTypeRaw)) {
        if (currentStatus !== 'AWAITING_SIGNATURES') {
          await tx.rollback();
          return res.status(400).json({
            error:
              'Contratos assinados e comprovantes só podem ser enviados em AWAITING_SIGNATURES.',
          });
        }
      }

      const doubleEnded = isDoubleEndedDeal(contract);
      const role = String(req.userRole ?? '').toLowerCase();
      const canEditSeller = canEditSellerSide(req, contract);
      const canEditBuyer = canEditBuyerSide(req, contract);

      const resolvedSide: 'seller' | 'buyer' | null = isSignedDocumentType(documentTypeRaw)
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

      if (!isSignedDocumentType(documentTypeRaw) && resolvedSide == null) {
        await tx.rollback();
        return res.status(400).json({
          error:
            'Informe o lado do documento (side: seller|buyer) para documentos de AWAITING_DOCS.',
        });
      }

      if (resolvedSide === 'seller' && !canEditSeller && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o corretor captador pode anexar documentos do lado seller.',
        });
      }

      if (resolvedSide === 'buyer' && !canEditBuyer && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o corretor vendedor pode anexar documentos do lado buyer.',
        });
      }

      const [insertResult] = await tx.query<ResultSetHeader>(
        `
          INSERT INTO negotiation_documents (
            negotiation_id,
            type,
            document_type,
            metadata_json,
            file_content,
            created_at
          ) VALUES (?, ?, ?, CAST(? AS JSON), ?, CURRENT_TIMESTAMP)
        `,
        [
          contract.negotiation_id,
          resolveDocumentStorageType(documentTypeRaw),
          documentTypeRaw,
          JSON.stringify({
            side: resolvedSide,
            originalFileName: uploadedFile.originalname ?? null,
            uploadedBy: Number(req.userId ?? 0) || null,
            uploadedAt: new Date().toISOString(),
          }),
          uploadedFile.buffer,
        ]
      );

      const documentId = Number(insertResult.insertId ?? 0);

      await tx.query(
        `
          UPDATE contracts
          SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [contractId]
      );

      await tx.commit();

      return res.status(201).json({
        message: 'Documento enviado com sucesso.',
        document: {
          id: documentId > 0 ? documentId : null,
          documentType: documentTypeRaw,
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

    const tx = await connection.getConnection();
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
          SELECT id, type, document_type, metadata_json
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
          error: 'Somente o corretor captador pode remover documentos do lado seller.',
        });
      }

      if (side === 'buyer' && !canEditBuyer && role !== 'admin' && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o corretor vendedor pode remover documentos do lado buyer.',
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

    let sellerPatch: Record<string, unknown> | null = null;
    let buyerPatch: Record<string, unknown> | null = null;

    try {
      sellerPatch = normalizeJsonObject(body.sellerInfo ?? body.seller_info, 'sellerInfo', {
        emptyStringAsNull: true,
      });
      buyerPatch = normalizeJsonObject(body.buyerInfo ?? body.buyer_info, 'buyerInfo', {
        emptyStringAsNull: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Payload inválido.';
      return res.status(400).json({ error: message });
    }

    if (!sellerPatch && !buyerPatch) {
      return res.status(400).json({
        error: 'Informe ao menos sellerInfo ou buyerInfo para atualização.',
      });
    }

    const tx = await connection.getConnection();
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
      const canEditSeller = canEditSellerSide(req, contract);
      const canEditBuyer = canEditBuyerSide(req, contract);

      if (sellerPatch && !canEditSeller && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o corretor captador pode editar sellerInfo.',
        });
      }

      if (buyerPatch && !canEditBuyer && !doubleEnded) {
        await tx.rollback();
        return res.status(403).json({
          error: 'Somente o corretor vendedor pode editar buyerInfo.',
        });
      }

      if (doubleEnded) {
        const userId = Number(req.userId);
        const isAdmin = String(req.userRole ?? '').toLowerCase() === 'admin';
        const sameBrokerId = Number(contract.capturing_broker_id ?? 0);
        if (!isAdmin && userId !== sameBrokerId) {
          await tx.rollback();
          return res.status(403).json({
            error:
              'Neste contrato de ponta dupla, apenas o corretor responsável pode editar os dois lados.',
          });
        }
      }

      const sellerInfo = parseStoredJsonObject(contract.seller_info);
      const buyerInfo = parseStoredJsonObject(contract.buyer_info);

      const nextSellerInfo = sellerPatch ? { ...sellerInfo, ...sellerPatch } : sellerInfo;
      const nextBuyerInfo = buyerPatch ? { ...buyerInfo, ...buyerPatch } : buyerInfo;

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
          JSON.stringify(nextSellerInfo),
          JSON.stringify(nextBuyerInfo),
          contractId,
        ]
      );

      const updatedContract = await fetchContractForUpdate(tx, contractId);
      await tx.commit();

      return res.status(200).json({
        message: 'Dados do contrato atualizados com sucesso.',
        contract: updatedContract ? mapContract(updatedContract) : null,
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
