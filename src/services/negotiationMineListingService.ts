import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';

import { optimizeCloudinaryImageUrl } from '../config/cloudinary';
import type { AuthRequest } from '../middlewares/auth';
import { queryNegotiationRows } from './negotiationPersistenceService';

type NegotiationListRow = RowDataPacket & {
  id: string;
  property_id: number;
  property_title: string | null;
  property_city: string | null;
  property_state: string | null;
  property_image: string | null;
  status: string;
  client_name: string | null;
  proposal_validity_date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  final_value: number | null;
  deal_type: string | null;
  payment_details: unknown;
  proposer_id: number | null;
  advertiser_id: number | null;
  proposer_name: string | null;
  advertiser_name: string | null;
  contract_id: string | null;
  contract_status: string | null;
  signed_proposal_count: number | null;
};

const PROPOSAL_EDITABLE_STATUSES = new Set(['PROPOSAL_DRAFT', 'PROPOSAL_SENT']);
const SIGNED_PROPOSAL_UPLOADABLE_STATUSES = new Set([
  'PROPOSAL_SENT',
  'DOCUMENTATION_PHASE',
  'AWAITING_SIGNATURES',
]);

function parsePage(value: unknown): number {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? 20);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 50) : 20;
}

function parsePropertyId(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parsePaymentBreakdown(value: unknown) {
  try {
    const source = typeof value === 'string' ? JSON.parse(value) : value;
    const details = source && typeof source === 'object'
      ? (source as Record<string, unknown>).details
      : null;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
    const item = details as Record<string, unknown>;
    const dinheiro = Number(item.dinheiro ?? 0);
    const permuta = Number(item.permuta ?? 0);
    const financiamento = Number(item.financiamento ?? 0);
    const outros = Number(item.outros ?? 0);
    return [dinheiro, permuta, financiamento, outros].every(Number.isFinite)
      ? { dinheiro, permuta, financiamento, outros }
      : null;
  } catch {
    return null;
  }
}

function parseBuyerEmail(value: unknown): string | null {
  try {
    const source = typeof value === 'string' ? JSON.parse(value) : value;
    const details = source && typeof source === 'object'
      ? (source as Record<string, unknown>).details
      : null;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return null;

    const item = details as Record<string, unknown>;
    return toTextOrNull(item.clientEmail ?? item.buyerEmail ?? item.buyer_email);
  } catch {
    return null;
  }
}

function parseRentalTerms(value: unknown) {
  try {
    const source = typeof value === 'string' ? JSON.parse(value) : value;
    const details = source && typeof source === 'object'
      ? (source as Record<string, unknown>).details
      : null;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
    const item = details as Record<string, unknown>;
    const rawTerms = item.rentalTerms ?? item.rental_terms;
    if (!rawTerms || typeof rawTerms !== 'object' || Array.isArray(rawTerms)) return null;
    const terms = rawTerms as Record<string, unknown>;
    return {
      monthlyRent: toFiniteNumber(terms.monthlyRent ?? terms.monthly_rent),
      guaranteeType: toTextOrNull(terms.guaranteeType ?? terms.guarantee_type),
      guaranteeAmount: toFiniteNumber(terms.guaranteeAmount ?? terms.guarantee_amount),
      leaseTermMonths: toFiniteNumber(terms.leaseTermMonths ?? terms.lease_term_months),
      expectedStartDate: toTextOrNull(terms.expectedStartDate ?? terms.expected_start_date),
      monthlyDueDay: toFiniteNumber(terms.monthlyDueDay ?? terms.monthly_due_day),
      condominiumResponsibility: toTextOrNull(
        terms.condominiumResponsibility ?? terms.condominium_responsibility
      ),
      propertyTaxResponsibility: toTextOrNull(
        terms.propertyTaxResponsibility ?? terms.property_tax_responsibility
      ),
      observations: toTextOrNull(terms.observations),
    };
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTextOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function mapRow(row: NegotiationListRow, userId: number) {
  const status = String(row.status ?? '').trim().toUpperCase();
  const isProposer = Number(row.proposer_id) === userId;
  const isAdvertiser = Number(row.advertiser_id) === userId;
  const hasSignedProposalDocument = Number(row.signed_proposal_count ?? 0) > 0;
  const contractId = row.contract_id ? String(row.contract_id) : null;
  const canEditProposal = isProposer && PROPOSAL_EDITABLE_STATUSES.has(status) && !hasSignedProposalDocument;

  return {
    id: String(row.id),
    propertyId: Number(row.property_id),
    propertyTitle: row.property_title ?? '',
    propertyCity: row.property_city ?? null,
    propertyState: row.property_state ?? null,
    propertyImage: optimizeCloudinaryImageUrl(row.property_image, { preset: 'thumb' }) ?? null,
    status,
    dealType: row.deal_type === 'sale' || row.deal_type === 'rent' ? row.deal_type : null,
    clientName: row.client_name ?? null,
    clientCpf: null,
    buyerEmail: parseBuyerEmail(row.payment_details),
    proposer: row.proposer_id ? { id: Number(row.proposer_id), name: row.proposer_name ?? null } : null,
    advertiser: row.advertiser_id ? { id: Number(row.advertiser_id), name: row.advertiser_name ?? null } : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    proposalValidUntil: toIso(row.proposal_validity_date),
    proposalValue: row.final_value == null ? null : Number(row.final_value),
    paymentBreakdown: parsePaymentBreakdown(row.payment_details),
    rentalTerms: parseRentalTerms(row.payment_details),
    hasSignedProposal: hasSignedProposalDocument,
    hasSignedProposalDocument,
    contract: contractId ? { id: contractId, status: row.contract_status ?? null } : null,
    // Compatibility fields retain the previous mobile contract while using the physical row only.
    canEditProposal,
    contractId,
    contractStatus: contractId ? row.contract_status ?? null : null,
    contractReadyProposal: contractId !== null,
    capabilities: {
      canRead: isProposer || isAdvertiser,
      canEditProposal,
      canDeleteProposal: canEditProposal,
      canDownloadDraft: isProposer || isAdvertiser,
      canUploadSignedProposal:
        isProposer && SIGNED_PROPOSAL_UPLOADABLE_STATUSES.has(status) && !hasSignedProposalDocument,
      canManageBuyerData: isProposer,
      canManageSellerData: isAdvertiser,
      canOpenContract: contractId !== null,
    },
  };
}

export async function listMine(req: AuthRequest, res: Response): Promise<Response> {
  const userId = Number(req.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Usuário não autenticado.' });
  }

  const query = req.query ?? {};
  const propertyId = parsePropertyId(query.propertyId);
  if (query.propertyId != null && propertyId === null) {
    return res.status(400).json({ error: 'propertyId inválido.' });
  }
  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);
  const offset = (page - 1) * limit;
  const propertyClause = propertyId === null ? '' : 'AND n.property_id = ?';
  const userParams = [userId, userId, userId, userId, userId];
  const params = propertyId === null ? userParams : [...userParams, propertyId];

  try {
    const countRows = await queryNegotiationRows<RowDataPacket>(
      `
        SELECT COUNT(*) AS total
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        LEFT JOIN contracts c ON c.negotiation_id = n.id
        WHERE (n.proposer_id = ? OR n.advertiser_id = ? OR n.legal_buyer_user_id = ? OR c.buyer_client_id = ? OR p.owner_id = ?)
        ${propertyClause}
      `,
      params,
    );
    const total = Number(countRows[0]?.total ?? 0);
    const rows = await queryNegotiationRows<NegotiationListRow>(
      `
        SELECT
          n.id, n.property_id, n.status, n.client_name,
          n.proposal_validity_date, n.created_at, n.updated_at, n.final_value, n.deal_type,
          n.payment_details, n.proposer_id, n.advertiser_id,
          p.title AS property_title, p.city AS property_city, p.state AS property_state,
          (SELECT pi.image_url FROM property_images pi WHERE pi.property_id = p.id ORDER BY pi.id ASC LIMIT 1) AS property_image,
          proposer_user.name AS proposer_name,
          COALESCE(advertiser_user.name, p.owner_name) AS advertiser_name,
          c.id AS contract_id, c.status AS contract_status,
          (SELECT COUNT(*) FROM negotiation_documents nd WHERE nd.negotiation_id = n.id AND nd.type = 'other' AND nd.document_type = 'contrato_assinado') AS signed_proposal_count
        FROM negotiations n
        JOIN properties p ON p.id = n.property_id
        LEFT JOIN users proposer_user ON proposer_user.id = n.proposer_id
        LEFT JOIN users advertiser_user ON advertiser_user.id = n.advertiser_id
        LEFT JOIN contracts c ON c.negotiation_id = n.id
        WHERE (n.proposer_id = ? OR n.advertiser_id = ? OR n.legal_buyer_user_id = ? OR c.buyer_client_id = ? OR p.owner_id = ?)
        ${propertyClause}
        ORDER BY n.updated_at DESC, n.created_at DESC, n.id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, limit, offset],
    );
    return res.status(200).json({
      data: rows.map((row) => mapRow(row, userId)),
      page,
      limit,
      total,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Erro ao listar negociações do usuário:', error);
    return res.status(500).json({ error: 'Falha ao listar negociações.' });
  }
}
