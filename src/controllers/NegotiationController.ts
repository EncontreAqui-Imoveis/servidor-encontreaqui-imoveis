import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import type { AuthRequest } from '../middlewares/auth';
import { getRequestId } from '../middlewares/requestContext';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import { createAdminNotification } from '../services/notificationService';
import {
  executeNegotiationStatement,
  findLatestNegotiationDocumentByType,
  findNegotiationDocumentById,
  generateNegotiationProposalPdf,
  getNegotiationDbConnection,
  queryNegotiationRows,
  saveNegotiationProposalDocument,
  saveNegotiationSignedProposalDocument,
} from '../services/negotiationPersistenceService';

interface NegotiationRow extends RowDataPacket {
  id: string;
  status: string;
}

interface NegotiationUploadRow extends RowDataPacket {
  id: string;
  property_id: number;
  status: string;
  capturing_broker_id: number;
  selling_broker_id: number | null;
  property_title: string | null;
  broker_name: string | null;
}

interface NegotiationListRow extends RowDataPacket {
  id: string;
  property_id: number;
  property_title: string | null;
  property_city: string | null;
  property_state: string | null;
  property_image: string | null;
  status: string;
  client_name: string | null;
  client_cpf: string | null;
  proposal_validity_date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  payment_details?: unknown;
}

type NegotiationSummaryPayload = {
  id: string;
  propertyId: number;
  propertyTitle: string;
  propertyCity: string | null;
  propertyState: string | null;
  propertyImage: string | null;
  status: string;
  clientName: string | null;
  clientCpf: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  proposalValidUntil: string | null;
};

interface NegotiationAccessRow extends RowDataPacket {
  id: string;
  capturing_broker_id: number | null;
  selling_broker_id: number | null;
  buyer_client_id: number | null;
}

interface BrokerRow extends RowDataPacket {
  name: string;
}

interface ProposalIdempotencyRow extends RowDataPacket {
  id: number;
  negotiation_id: string | null;
  document_id: number | null;
}

interface PropertyRow extends RowDataPacket {
  id: number;
  broker_id: number | null;
  owner_id: number | null;
  status: string | null;
  address: string | null;
  numero: string | null;
  quadra: string | null;
  lote: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
  price: number | null;
  price_sale: number | null;
  price_rent: number | null;
}

interface ProposalBody {
  clientName?: unknown;
  client_name?: unknown;
  clientCpf?: unknown;
  client_cpf?: unknown;
  propertyAddress?: unknown;
  property_address?: unknown;
  brokerName?: unknown;
  broker_name?: unknown;
  sellingBrokerName?: unknown;
  selling_broker_name?: unknown;
  value?: unknown;
  paymentMethod?: unknown;
  payment_method?: unknown;
  payment?: {
    cash?: unknown;
    tradeIn?: unknown;
    trade_in?: unknown;
    financing?: unknown;
    others?: unknown;
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
  validityDays?: unknown;
  validity_days?: unknown;
}

interface ProposalWizardBody {
  propertyId?: unknown;
  clientName?: unknown;
  clientCpf?: unknown;
  validadeDias?: unknown;
  sellerBrokerId?: unknown;
  proposalValue?: unknown;
  valorProposta?: unknown;
  pagamento?: {
    dinheiro?: unknown;
    permuta?: unknown;
    financiamento?: unknown;
    outros?: unknown;
  };
}

interface ParsedProposalWizard {
  propertyId: number;
  clientName: string;
  clientCpf: string;
  validadeDias: number;
  sellerBrokerId: number | null;
  pagamento: {
    dinheiro: number;
    permuta: number;
    financiamento: number;
    outros: number;
  };
}

const ACTIVE_NEGOTIATION_STATUSES = [
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'AWAITING_SIGNATURES',
] as const;

const DEFAULT_WIZARD_STATUS = 'PROPOSAL_SENT';
const SIGNED_PROPOSAL_REVIEW_STATUS = 'DOCUMENTATION_PHASE';
const SIGNED_PROPOSAL_ALLOWED_CURRENT_STATUS = new Set([
  'PROPOSAL_SENT',
  'AWAITING_SIGNATURES',
]);

function toCents(value: number): number {
  return Math.round(value * 100);
}

function parsePositiveNumber(input: unknown, fieldName: string): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} deve ser um numero maior ou igual a zero.`);
  }
  return parsed;
}

function normalizeProposalCpfKey(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

function parseProposalData(body: ProposalBody): ProposalData {
  const clientName = String(body.clientName ?? body.client_name ?? '').trim();
  const clientCpf = String(body.clientCpf ?? body.client_cpf ?? '').trim();
  const propertyAddress = String(body.propertyAddress ?? body.property_address ?? '').trim();
  const brokerName = String(body.brokerName ?? body.broker_name ?? '').trim();
  const rawSellingBrokerName = body.sellingBrokerName ?? body.selling_broker_name;
  const sellingBrokerName = rawSellingBrokerName == null ? null : String(rawSellingBrokerName).trim();
  const numericValue = Number(body.value);
  const paymentMethod = String(body.paymentMethod ?? body.payment_method ?? '').trim();
  const validityDays = Number(body.validityDays ?? body.validity_days ?? 10);
  const payment = body.payment ?? {};

  const parsePaymentField = (fieldName: string, ...values: unknown[]): number => {
    const firstDefined = values.find(
      (value) => value !== undefined && value !== null && String(value).trim() !== ''
    );
    if (firstDefined === undefined) {
      return 0;
    }
    return parsePositiveNumber(firstDefined, fieldName);
  };

  let cash = parsePaymentField('payment.cash', payment.cash, payment.dinheiro);
  const tradeIn = parsePaymentField('payment.trade_in', payment.trade_in, payment.tradeIn, payment.permuta);
  const financing = parsePaymentField(
    'payment.financing',
    payment.financing,
    payment.financiamento
  );
  const others = parsePaymentField('payment.others', payment.others, payment.outros);

  if (!clientName || !clientCpf || !propertyAddress || !brokerName) {
    throw new Error(
      'Campos obrigatorios ausentes. Informe client_name, client_cpf, property_address e broker_name.'
    );
  }

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    throw new Error('Campo value deve ser um numero maior que zero.');
  }

  if (!Number.isInteger(validityDays) || validityDays <= 0) {
    throw new Error('Campo validity_days deve ser um inteiro maior que zero.');
  }

  let paymentTotal = cash + tradeIn + financing + others;
  if (paymentTotal <= 0) {
    // Compatibilidade retroativa: payload legado sem objeto payment.
    cash = numericValue;
    paymentTotal = numericValue;
  }

  if (toCents(paymentTotal) !== toCents(numericValue)) {
    throw new Error('payment breakdown must match total value');
  }

  return {
    clientName,
    clientCpf,
    propertyAddress,
    brokerName,
    sellingBrokerName: sellingBrokerName || null,
    value: numericValue,
    payment: {
      cash,
      tradeIn,
      financing,
      others,
    },
    paymentMethod: paymentMethod || undefined,
    validityDays,
  };
}

function parseProposalWizardBody(body: ProposalWizardBody): ParsedProposalWizard {
  const propertyId = Number(body.propertyId);
  const clientName = String(body.clientName ?? '').trim();
  const clientCpfDigits = String(body.clientCpf ?? '').replace(/\D/g, '');
  const validadeDiasRaw = body.validadeDias ?? 10;
  const validadeDias = Number(validadeDiasRaw);
  const sellerBrokerIdRaw = body.sellerBrokerId;
  const sellerBrokerId =
    sellerBrokerIdRaw === undefined || sellerBrokerIdRaw === null || sellerBrokerIdRaw === ''
      ? null
      : Number(sellerBrokerIdRaw);
  const pagamento = body.pagamento ?? {};
  const dinheiro = parsePositiveNumber(pagamento.dinheiro ?? 0, 'pagamento.dinheiro');
  const permuta = parsePositiveNumber(pagamento.permuta ?? 0, 'pagamento.permuta');
  const financiamento = parsePositiveNumber(
    pagamento.financiamento ?? 0,
    'pagamento.financiamento'
  );
  const outros = parsePositiveNumber(pagamento.outros ?? 0, 'pagamento.outros');

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    throw new Error('propertyId invalido.');
  }

  if (!clientName) {
    throw new Error('clientName e obrigatorio.');
  }

  if (clientCpfDigits.length != 11) {
    throw new Error('clientCpf invalido. Informe 11 digitos.');
  }

  if (!Number.isInteger(validadeDias) || validadeDias <= 0) {
    throw new Error('validadeDias deve ser um inteiro maior que zero.');
  }

  if (sellerBrokerId !== null && (!Number.isInteger(sellerBrokerId) || sellerBrokerId <= 0)) {
    throw new Error('sellerBrokerId invalido.');
  }

  return {
    propertyId,
    clientName,
    clientCpf: clientCpfDigits,
    validadeDias,
    sellerBrokerId,
    pagamento: {
      dinheiro,
      permuta,
      financiamento,
      outros,
    },
  };
}

function resolvePropertyAddress(row: PropertyRow): string {
  const parts = [
    row.address,
    row.numero ? `Nº ${row.numero}` : null,
    row.bairro,
    row.city,
    row.state,
    row.quadra ? `Quadra ${row.quadra}` : null,
    row.lote ? `Lote ${row.lote}` : null,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  return parts.join(', ');
}

function resolvePropertyValue(row: PropertyRow): number {
  const sale = Number(row.price_sale ?? 0);
  const rent = Number(row.price_rent ?? 0);
  const fallback = Number(row.price ?? 0);
  const resolved = sale > 0 ? sale : rent > 0 ? rent : fallback;
  return Number.isFinite(resolved) && resolved > 0 ? resolved : 0;
}

function buildProposalValidityDate(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() + days);
  const yyyy = now.getFullYear().toString().padStart(4, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }
  return parsed.toISOString();
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const code = String((error as { code?: unknown })?.code ?? '').trim().toUpperCase();
  return (
    code === 'ER_BAD_FIELD_ERROR' ||
    code === 'ER_PARSE_ERROR' ||
    code === 'ER_INVALID_JSON_TEXT' ||
    code === 'ER_WRONG_FIELD_WITH_GROUP'
  );
}

function getNestedObjectValue(
  source: Record<string, unknown>,
  path: readonly string[]
): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized.length > 0 && normalized.toLowerCase() !== 'null') {
      return normalized;
    }
  }
  return null;
}

function resolveNegotiationClientName(row: NegotiationListRow): string | null {
  const paymentDetails = parseJsonObjectSafe(row.payment_details);
  return firstNonEmptyString(
    row.client_name,
    getNestedObjectValue(paymentDetails, ['details', 'clientName']),
    getNestedObjectValue(paymentDetails, ['details', 'client_name']),
    paymentDetails.clientName,
    paymentDetails.client_name
  );
}

function resolveNegotiationClientCpf(row: NegotiationListRow): string | null {
  const paymentDetails = parseJsonObjectSafe(row.payment_details);
  return firstNonEmptyString(
    row.client_cpf,
    getNestedObjectValue(paymentDetails, ['details', 'clientCpf']),
    getNestedObjectValue(paymentDetails, ['details', 'client_cpf']),
    paymentDetails.clientCpf,
    paymentDetails.client_cpf
  );
}

function mapNegotiationSummaryRow(row: NegotiationListRow): NegotiationSummaryPayload {
  return {
    id: row.id,
    propertyId: Number(row.property_id),
    propertyTitle: row.property_title ?? '',
    propertyCity: row.property_city ?? null,
    propertyState: row.property_state ?? null,
    propertyImage: row.property_image ?? null,
    status: String(row.status ?? '').trim().toUpperCase(),
    clientName: resolveNegotiationClientName(row),
    clientCpf: resolveNegotiationClientCpf(row),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    proposalValidUntil: toIsoString(row.proposal_validity_date),
  };
}

type NegotiationColumnFlags = {
  hasSellingBrokerId: boolean;
  hasBuyerClientId: boolean;
  hasClientName: boolean;
  hasClientCpf: boolean;
  hasProposalValidityDate: boolean;
  hasCreatedAt: boolean;
  hasUpdatedAt: boolean;
  hasPaymentDetails: boolean;
};

async function getNegotiationColumnFlags(): Promise<NegotiationColumnFlags> {
  const rows = await queryNegotiationRows<RowDataPacket>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'negotiations'
        AND column_name IN (
          'selling_broker_id',
          'buyer_client_id',
          'client_name',
          'client_cpf',
          'proposal_validity_date',
          'created_at',
          'updated_at',
          'payment_details'
        )
    `,
    []
  );

  const columns = new Set(
    rows.map((row) => String((row as { column_name?: unknown }).column_name ?? '').trim())
  );

  return {
    hasSellingBrokerId: columns.has('selling_broker_id'),
    hasBuyerClientId: columns.has('buyer_client_id'),
    hasClientName: columns.has('client_name'),
    hasClientCpf: columns.has('client_cpf'),
    hasProposalValidityDate: columns.has('proposal_validity_date'),
    hasCreatedAt: columns.has('created_at'),
    hasUpdatedAt: columns.has('updated_at'),
    hasPaymentDetails: columns.has('payment_details'),
  };
}

async function queryMineNegotiationsCurrent(userId: number): Promise<NegotiationSummaryPayload[]> {
  const rows = await queryNegotiationRows<NegotiationListRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        p.city AS property_city,
        p.state AS property_state,
        MIN(pi.image_url) AS property_image,
        n.status,
        COALESCE(
          NULLIF(n.client_name, ''),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientName')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_name')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientName')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_name'))
        ) AS client_name,
        COALESCE(
          NULLIF(n.client_cpf, ''),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.clientCpf')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.details.client_cpf')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.clientCpf')),
          JSON_UNQUOTE(JSON_EXTRACT(n.payment_details, '$.client_cpf'))
        ) AS client_cpf,
        n.proposal_validity_date,
        n.created_at,
        n.updated_at
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      LEFT JOIN property_images pi ON pi.property_id = p.id
      WHERE (n.capturing_broker_id = ? OR n.selling_broker_id = ? OR n.buyer_client_id = ?)
        AND UPPER(TRIM(n.status)) NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED', 'SOLD', 'RENTED')
      GROUP BY
        n.id,
        n.property_id,
        p.title,
        p.city,
        p.state,
        n.status,
        client_name,
        client_cpf,
        n.proposal_validity_date,
        n.created_at,
        n.updated_at
      ORDER BY n.updated_at DESC, n.created_at DESC
    `,
    [userId, userId, userId]
  );

  return rows.map(mapNegotiationSummaryRow);
}

async function queryMineNegotiationsLegacy(userId: number): Promise<NegotiationSummaryPayload[]> {
  const flags = await getNegotiationColumnFlags();
  const selectCreatedAt = flags.hasCreatedAt ? 'n.created_at' : 'NULL';
  const selectPaymentDetails = flags.hasPaymentDetails ? 'n.payment_details' : 'NULL';

  const rows = await queryNegotiationRows<NegotiationListRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        p.city AS property_city,
        p.state AS property_state,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = p.id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image,
        n.status,
        NULL AS client_name,
        NULL AS client_cpf,
        NULL AS proposal_validity_date,
        ${selectCreatedAt} AS created_at,
        ${selectCreatedAt} AS updated_at,
        ${selectPaymentDetails} AS payment_details
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      WHERE n.capturing_broker_id = ?
      ORDER BY ${flags.hasCreatedAt ? 'n.created_at DESC,' : ''} n.id DESC
    `,
    [userId]
  );

  return rows.map(mapNegotiationSummaryRow);
}

async function queryMineNegotiationsSchemaAware(
  userId: number
): Promise<NegotiationSummaryPayload[]> {
  const flags = await getNegotiationColumnFlags();

  const selectClientName = flags.hasClientName ? 'n.client_name' : 'NULL';
  const selectClientCpf = flags.hasClientCpf ? 'n.client_cpf' : 'NULL';
  const selectProposalValidityDate = flags.hasProposalValidityDate
    ? 'n.proposal_validity_date'
    : 'NULL';
  const selectCreatedAt = flags.hasCreatedAt ? 'n.created_at' : 'NULL';
  const selectUpdatedAt = flags.hasUpdatedAt
    ? 'n.updated_at'
    : flags.hasCreatedAt
      ? 'n.created_at'
      : 'NULL';
  const selectPaymentDetails = flags.hasPaymentDetails ? 'n.payment_details' : 'NULL';

  const whereClauses = ['n.capturing_broker_id = ?'];
  const params: number[] = [userId];

  if (flags.hasSellingBrokerId) {
    whereClauses.push('n.selling_broker_id = ?');
    params.push(userId);
  }

  if (flags.hasBuyerClientId) {
    whereClauses.push('n.buyer_client_id = ?');
    params.push(userId);
  }

  const rows = await queryNegotiationRows<NegotiationListRow>(
    `
      SELECT
        n.id,
        n.property_id,
        p.title AS property_title,
        p.city AS property_city,
        p.state AS property_state,
        (
          SELECT pi.image_url
          FROM property_images pi
          WHERE pi.property_id = p.id
          ORDER BY pi.id ASC
          LIMIT 1
        ) AS property_image,
        n.status,
        ${selectClientName} AS client_name,
        ${selectClientCpf} AS client_cpf,
        ${selectProposalValidityDate} AS proposal_validity_date,
        ${selectCreatedAt} AS created_at,
        ${selectUpdatedAt} AS updated_at,
        ${selectPaymentDetails} AS payment_details
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      WHERE ${whereClauses.join(' OR ')}
      ORDER BY ${selectUpdatedAt !== 'NULL' ? `${selectUpdatedAt} DESC,` : ''} ${
        selectCreatedAt !== 'NULL' ? `${selectCreatedAt} DESC,` : ''
      } n.id DESC
    `,
    params
  );

  return rows.map(mapNegotiationSummaryRow);
}

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function sanitizeDownloadFilename(value: string): string {
  const sanitized = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return 'documento.pdf';
  }
  return sanitized;
}

function buildAttachmentDisposition(filename: string): string {
  const safe = sanitizeDownloadFilename(filename);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function canAccessNegotiationByOwnership(
  userId: number,
  negotiation: NegotiationAccessRow
): boolean {
  return (
    userId === Number(negotiation.capturing_broker_id ?? 0) ||
    userId === Number(negotiation.selling_broker_id ?? 0) ||
    userId === Number(negotiation.buyer_client_id ?? 0)
  );
}

function resolveIdempotencyKey(req: AuthRequest): string {
  const fromHeader = String(req.get('Idempotency-Key') ?? '').trim();
  if (fromHeader.length > 0) {
    return fromHeader.slice(0, 128);
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const fromBody = String(body.idempotency_key ?? body.idempotencyKey ?? '').trim();
  return fromBody.slice(0, 128);
}

function isDependencyUnavailableError(error: unknown): boolean {
  const anyError = error as {
    isAxiosError?: boolean;
    code?: string | null;
    message?: string | null;
  };

  const code = String(anyError?.code ?? '').toUpperCase();
  const message = String(anyError?.message ?? '').toUpperCase();

  if (message.includes('PDF_INTERNAL_API_KEY')) {
    return true;
  }

  if (anyError?.isAxiosError) {
    return true;
  }

  return ['ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code);
}

class NegotiationController {
  private correlationId(req: Request): string | null {
    return getRequestId(req);
  }

  private respondWithCode(
    req: Request,
    res: Response,
    statusCode: number,
    code: string,
    error: string,
    retryable: boolean,
    extras?: Record<string, unknown>
  ): Response {
    return res.status(statusCode).json({
      status: 'error',
      code,
      error,
      retryable,
      correlation_id: this.correlationId(req),
      ...(extras ?? {}),
    });
  }

  async listMine(req: AuthRequest, res: Response): Promise<Response> {
    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    try {
      let data: NegotiationSummaryPayload[];
      try {
        data = await queryMineNegotiationsCurrent(userId);
      } catch (error) {
        console.warn(
          'Fallback schema-aware ativado em /negotiations/mine:',
          (error as { code?: string; message?: string }).code ??
            (error as { message?: string }).message ??
            error,
        );

        try {
          data = await queryMineNegotiationsSchemaAware(userId);
        } catch (fallbackError) {
          if (!isSchemaCompatibilityError(fallbackError)) {
            throw fallbackError;
          }

          console.warn(
            'Fallback legado ativado em /negotiations/mine:',
            (fallbackError as { code?: string; message?: string }).code ??
              (fallbackError as { message?: string }).message ??
              fallbackError,
          );
          data = await queryMineNegotiationsLegacy(userId);
        }
      }

      return res.status(200).json({
        data,
      });
    } catch (error) {
      console.error('Erro ao listar negociações do usuário:', error);
      return res.status(500).json({ error: 'Falha ao listar negociações.' });
    }
  }

  async generateProposal(req: AuthRequest, res: Response): Promise<Response> {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociacao invalido.' });
    }

    let proposalData: ProposalData;
    try {
      proposalData = parseProposalData((req.body ?? {}) as ProposalBody);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }

    try {
      const negotiationRows = await queryNegotiationRows<NegotiationRow>(
        'SELECT id FROM negotiations WHERE id = ? LIMIT 1',
        [negotiationId]
      );

      if (!negotiationRows.length) {
        return res.status(404).json({ error: 'Negociacao nao encontrada.' });
      }

      await executeNegotiationStatement(
        `
          UPDATE negotiations
          SET
            client_name = ?,
            client_cpf = ?
          WHERE id = ?
        `,
        [proposalData.clientName, proposalData.clientCpf, negotiationId]
      );

      const pdfBuffer = await generateNegotiationProposalPdf(proposalData);
      const documentId = await saveNegotiationProposalDocument(
        negotiationId,
        pdfBuffer,
        undefined,
        {
          originalFileName: 'proposta.pdf',
          generated: true,
        }
      );

      return res.status(201).json({
        id: documentId,
        message: 'Proposta gerada e armazenada com sucesso.',
        negotiationId,
        sizeBytes: pdfBuffer.length,
      });
    } catch (error) {
      console.error('Erro ao gerar/salvar proposta em BLOB:', error);
      if (isDependencyUnavailableError(error)) {
        return this.respondWithCode(
          req,
          res,
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Servico temporariamente indisponivel. Tente novamente em instantes.',
          true
        );
      }
      return this.respondWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Falha ao gerar e salvar proposta.',
        false
      );
    }
  }

  async generateProposalFromProperty(req: AuthRequest, res: Response): Promise<Response> {
    if (!req.userId) {
      return this.respondWithCode(
        req,
        res,
        401,
        'SESSION_EXPIRED',
        'Usuario nao autenticado.',
        false
      );
    }

    const idempotencyKey = resolveIdempotencyKey(req);
    if (!idempotencyKey) {
      return this.respondWithCode(
        req,
        res,
        400,
        'PROPOSAL_VALIDATION_FAILED',
        'idempotency_key e obrigatoria para envio da proposta.',
        false
      );
    }

    let payload: ParsedProposalWizard;
    try {
      payload = parseProposalWizardBody((req.body ?? {}) as ProposalWizardBody);
    } catch (error) {
      return this.respondWithCode(
        req,
        res,
        400,
        'PROPOSAL_VALIDATION_FAILED',
        (error as Error).message,
        false
      );
    }

    let tx: PoolConnection | null = null;
    try {
      tx = await getNegotiationDbConnection();
      await tx.beginTransaction();

      const [idempotencyRows] = await tx.query<ProposalIdempotencyRow[]>(
        `
          SELECT id, negotiation_id, document_id
          FROM negotiation_proposal_idempotency
          WHERE user_id = ? AND idempotency_key = ?
          LIMIT 1
          FOR UPDATE
        `,
        [req.userId, idempotencyKey]
      );

      const existingIdempotency = idempotencyRows[0];
      if (
        existingIdempotency &&
        existingIdempotency.negotiation_id &&
        existingIdempotency.document_id
      ) {
        const existingDocument = await findNegotiationDocumentById(
          Number(existingIdempotency.document_id),
          tx
        );
        if (
          existingDocument &&
          String(existingDocument.negotiationId) ===
            String(existingIdempotency.negotiation_id)
        ) {
          await tx.commit();

          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader(
            'Content-Disposition',
            `attachment; filename="proposal_${existingIdempotency.negotiation_id}.pdf"`
          );
          res.setHeader(
            'Content-Length',
            existingDocument.fileContent.length.toString()
          );
          res.setHeader('X-Negotiation-Id', String(existingIdempotency.negotiation_id));
          res.setHeader('X-Document-Id', String(existingIdempotency.document_id));
          res.setHeader('X-Idempotent-Replay', 'true');
          return res.status(200).send(existingDocument.fileContent);
        }

        await tx.rollback();
        return this.respondWithCode(
          req,
          res,
          409,
          'PROPOSAL_IN_PROGRESS',
          'Uma proposta com essa chave de idempotencia ainda esta em processamento.',
          true
        );
      }

      if (!existingIdempotency) {
        await tx.execute(
          `
            INSERT INTO negotiation_proposal_idempotency (user_id, idempotency_key)
            VALUES (?, ?)
          `,
          [req.userId, idempotencyKey]
        );
      }

      const [propertyRows] = await tx.query<PropertyRow[]>(
        `
          SELECT
            id,
            broker_id,
            owner_id,
            status,
            address,
            numero,
            quadra,
            lote,
            bairro,
            city,
            state,
            price,
            price_sale,
            price_rent
          FROM properties
          WHERE id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [payload.propertyId]
      );

      const property = propertyRows[0];
      if (!property) {
        await tx.rollback();
        return res.status(404).json({ error: 'Imovel nao encontrado.' });
      }
      const userRole = String(req.userRole ?? '').trim().toLowerCase();
      const isClientUser = userRole === 'client';
      const isBrokerUser = userRole === 'broker';
      if (!isClientUser && !isBrokerUser) {
        await tx.rollback();
        return res.status(403).json({ error: 'Apenas clientes ou corretores podem enviar proposta.' });
      }
      if (isBrokerUser) {
        if (Number(property.broker_id ?? 0) !== Number(req.userId ?? 0)) {
          await tx.rollback();
          return res.status(403).json({
            error: 'Somente o corretor captador deste imóvel pode gerar proposta.',
          });
        }
      } else {
        if (Number(property.owner_id ?? 0) === Number(req.userId ?? 0)) {
          await tx.rollback();
          return res.status(403).json({ error: 'Nao e possivel enviar proposta no proprio anuncio.' });
        }
        if (!property.broker_id) {
          await tx.rollback();
          return res.status(400).json({ error: 'Imovel sem corretor responsavel.' });
        }
      }
      if (String(property.status ?? '').trim().toLowerCase() !== 'approved') {
        await tx.rollback();
        return res.status(409).json({
          error: 'A proposta só pode ser gerada para imóveis aprovados.',
        });
      }

      const listingValue = resolvePropertyValue(property);
      if (listingValue <= 0) {
        await tx.rollback();
        return res.status(400).json({ error: 'Imovel sem valor valido para gerar proposta.' });
      }

      const body = req.body as ProposalWizardBody;
      const rawDeclared =
        body.proposalValue ?? body.valorProposta ?? (req.body as { proposal_value?: unknown }).proposal_value;
      let proposalValue = listingValue;
      if (rawDeclared !== undefined && rawDeclared !== null && String(rawDeclared).trim() !== '') {
        const parsedDeclared = Number(rawDeclared);
        if (!Number.isFinite(parsedDeclared) || parsedDeclared <= 0) {
          await tx.rollback();
          return res.status(400).json({ error: 'proposalValue invalido.' });
        }
        proposalValue = Number(parsedDeclared.toFixed(2));
      }

      const paymentTotal =
        payload.pagamento.dinheiro +
        payload.pagamento.permuta +
        payload.pagamento.financiamento +
        payload.pagamento.outros;

      if (toCents(paymentTotal) !== toCents(proposalValue)) {
        await tx.rollback();
        return res.status(400).json({
          error: 'A soma dos pagamentos deve ser exatamente igual ao valor total informado na proposta.',
          propertyValue: proposalValue,
          paymentTotal,
        });
      }

      const capturingBrokerId = isClientUser ? Number(property.broker_id ?? 0) : Number(req.userId ?? 0);
      if (!Number.isFinite(capturingBrokerId) || capturingBrokerId <= 0) {
        await tx.rollback();
        return res.status(400).json({ error: 'Corretor captador invalido para esta proposta.' });
      }

      const [capturingBrokerRows] = await tx.query<BrokerRow[]>(
        'SELECT name FROM users WHERE id = ? LIMIT 1',
        [capturingBrokerId]
      );
      const brokerName = String(capturingBrokerRows[0]?.name ?? '').trim();
      if (!brokerName) {
        await tx.rollback();
        return res.status(400).json({ error: 'Corretor nao encontrado para gerar proposta.' });
      }

      const cpfKey = normalizeProposalCpfKey(payload.clientCpf);
      if (cpfKey.length !== 11) {
        await tx.rollback();
        return res.status(400).json({ error: 'CPF do cliente invalido na proposta.' });
      }

      const buyerClientId: number | null = isClientUser ? Number(req.userId) : null;

      const sellerBrokerId = capturingBrokerId;
      const sellingBrokerName = brokerName;

      const normalizedCpfExpr = `REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(client_cpf, ''), '.', ''), '-', ''), '/', ''), ' ', '')`;

      const [existingRows] = await tx.query<NegotiationRow[]>(
        `
          SELECT id, status
          FROM negotiations
          WHERE property_id = ?
            AND capturing_broker_id = ?
            AND status IN (${ACTIVE_NEGOTIATION_STATUSES.map(() => '?').join(', ')})
            AND (
              (buyer_client_id IS NOT NULL AND buyer_client_id = ?)
              OR (
                buyer_client_id IS NULL
                AND ${normalizedCpfExpr} = ?
              )
            )
          LIMIT 1
          FOR UPDATE
        `,
        [payload.propertyId, capturingBrokerId, ...ACTIVE_NEGOTIATION_STATUSES, buyerClientId, cpfKey]
      );

      const paymentDetails = JSON.stringify({
        method: 'OTHER',
        amount: Number(proposalValue.toFixed(2)),
        details: {
          ...payload.pagamento,
          clientName: payload.clientName,
          clientCpf: payload.clientCpf,
          listingValue: Number(listingValue.toFixed(2)),
        },
      });
      const proposalValidityDate = buildProposalValidityDate(payload.validadeDias);

      let negotiationId = '';
      let fromStatus = 'PROPOSAL_DRAFT';

      if (existingRows.length > 0) {
        negotiationId = existingRows[0].id;
        fromStatus = existingRows[0].status;
        await tx.execute(
          `
            UPDATE negotiations
            SET
              capturing_broker_id = ?,
              selling_broker_id = ?,
              buyer_client_id = ?,
              client_name = ?,
              client_cpf = ?,
              status = ?,
              final_value = ?,
              payment_details = CAST(? AS JSON),
              proposal_validity_date = ?,
              version = version + 1
            WHERE id = ?
          `,
          [
            capturingBrokerId,
            sellerBrokerId,
            buyerClientId,
            payload.clientName,
            payload.clientCpf,
            DEFAULT_WIZARD_STATUS,
            proposalValue,
            paymentDetails,
            proposalValidityDate,
            negotiationId,
          ]
        );
      } else {
        negotiationId = randomUUID();
        await tx.execute(
          `
            INSERT INTO negotiations (
              id,
              property_id,
              capturing_broker_id,
              selling_broker_id,
              buyer_client_id,
              client_name,
              client_cpf,
              status,
              final_value,
              payment_details,
              proposal_validity_date,
              version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?, 0)
          `,
          [
            negotiationId,
            payload.propertyId,
            capturingBrokerId,
            sellerBrokerId,
            buyerClientId,
            payload.clientName,
            payload.clientCpf,
            DEFAULT_WIZARD_STATUS,
            proposalValue,
            paymentDetails,
            proposalValidityDate,
          ]
        );
      }

      await tx.execute(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          negotiationId,
          fromStatus,
          DEFAULT_WIZARD_STATUS,
          req.userId,
          JSON.stringify({
            source: 'mobile_proposal_wizard',
            payment: payload.pagamento,
            sellerBrokerId,
            capturingBrokerId,
            buyerClientId,
            clientName: payload.clientName,
            clientCpf: payload.clientCpf,
          }),
        ]
      );

      const proposalData: ProposalData = {
        clientName: payload.clientName,
        clientCpf: payload.clientCpf,
        propertyAddress: resolvePropertyAddress(property),
        brokerName,
        sellingBrokerName,
        value: proposalValue,
        payment: {
          cash: payload.pagamento.dinheiro,
          tradeIn: payload.pagamento.permuta,
          financing: payload.pagamento.financiamento,
          others: payload.pagamento.outros,
        },
        validityDays: payload.validadeDias,
      };

      const pdfBuffer = await generateNegotiationProposalPdf(proposalData);
      const documentId = await saveNegotiationProposalDocument(
        negotiationId,
        pdfBuffer,
        tx,
        {
          originalFileName: 'proposta.pdf',
          generated: true,
        }
      );

      await tx.execute(
        `
          UPDATE negotiation_proposal_idempotency
          SET negotiation_id = ?, document_id = ?
          WHERE user_id = ? AND idempotency_key = ?
        `,
        [negotiationId, documentId, req.userId, idempotencyKey]
      );

      await tx.commit();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="proposal_${negotiationId}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length.toString());
      res.setHeader('X-Negotiation-Id', negotiationId);
      res.setHeader('X-Document-Id', String(documentId));
      return res.status(201).send(pdfBuffer);
    } catch (error: any) {
      if (tx) {
        await tx.rollback();
      }
      console.error('Erro ao gerar proposta por imovel:', error);
      if (error?.code === 'ER_DUP_ENTRY') {
        return this.respondWithCode(
          req,
          res,
          409,
          'PROPOSAL_IN_PROGRESS',
          'Uma proposta com essa chave de idempotencia ja esta em processamento.',
          true
        );
      }
      if (isDependencyUnavailableError(error)) {
        return this.respondWithCode(
          req,
          res,
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Servico temporariamente indisponivel. Tente novamente em instantes.',
          true
        );
      }
      return this.respondWithCode(
        req,
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Falha ao gerar proposta.',
        false
      );
    } finally {
      tx?.release();
    }
  }

  async uploadSignedProposal(req: AuthRequest, res: Response): Promise<Response> {
    if (!req.userId) {
      return res.status(401).json({ error: 'Usuario nao autenticado.' });
    }

    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    const uploadedFile = (req as Request & { file?: Express.Multer.File }).file;
    if (!uploadedFile || !uploadedFile.buffer || uploadedFile.buffer.length === 0) {
      return res.status(400).json({ error: 'PDF assinado não enviado.' });
    }

    const mime = String(uploadedFile.mimetype ?? '').toLowerCase();
    if (mime && mime !== 'application/pdf') {
      return res.status(400).json({ error: 'Arquivo inválido. Envie apenas PDF assinado.' });
    }

    let tx: PoolConnection | null = null;
    try {
      tx = await getNegotiationDbConnection();
      await tx.beginTransaction();

      const [negotiationRows] = await tx.query<NegotiationUploadRow[]>(
        `
          SELECT
            n.id,
            n.property_id,
            n.status,
            n.capturing_broker_id,
            n.selling_broker_id,
            p.title AS property_title,
            u.name AS broker_name
          FROM negotiations n
          JOIN properties p ON p.id = n.property_id
          LEFT JOIN users u ON u.id = n.capturing_broker_id
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

      const isAuthorizedBroker =
        req.userId === Number(negotiation.capturing_broker_id) ||
        req.userId === Number(negotiation.selling_broker_id ?? 0);
      if (!isAuthorizedBroker) {
        await tx.rollback();
        return res.status(403).json({ error: 'Você não possui permissão para enviar esta proposta.' });
      }

      const currentStatus = String(negotiation.status ?? '').trim().toUpperCase();
      if (!SIGNED_PROPOSAL_ALLOWED_CURRENT_STATUS.has(currentStatus)) {
        await tx.rollback();
        return res.status(400).json({
          error: 'A proposta assinada só pode ser enviada enquanto aguarda assinatura.',
        });
      }

      const documentId = await saveNegotiationSignedProposalDocument(
        negotiationId,
        uploadedFile.buffer,
        tx,
        {
          originalFileName: uploadedFile.originalname ?? 'proposta_assinada.pdf',
          uploadedBy: Number(req.userId ?? 0) || null,
          uploadedAt: new Date().toISOString(),
        }
      );

      await tx.execute(
        `
          UPDATE negotiations
          SET status = ?, version = version + 1
          WHERE id = ?
        `,
        [SIGNED_PROPOSAL_REVIEW_STATUS, negotiationId]
      );

      await tx.execute(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          )
          VALUES (UUID(), ?, ?, ?, ?, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          negotiationId,
          currentStatus,
          SIGNED_PROPOSAL_REVIEW_STATUS,
          req.userId,
          JSON.stringify({
            action: 'signed_proposal_uploaded',
            documentId,
            filename: uploadedFile.originalname ?? null,
          }),
        ]
      );

      await tx.commit();

      const propertyTitle = String(negotiation.property_title ?? '').trim() || 'Imóvel sem título';
      const brokerName = String(negotiation.broker_name ?? `#${req.userId}`);
      await createAdminNotification({
        type: 'negotiation',
        title: `Proposta Enviada: ${propertyTitle}`,
        message: `O corretor ${brokerName} enviou uma proposta assinada para o imóvel ${propertyTitle}.`,
        relatedEntityId: Number(negotiation.property_id),
        metadata: {
          negotiationId,
          propertyId: Number(negotiation.property_id),
          brokerId: req.userId,
          documentId,
        },
      });

      return res.status(201).json({
        message: 'Proposta assinada enviada com sucesso. Em análise.',
        status: 'UNDER_REVIEW',
        negotiationId,
        documentId,
      });
    } catch (error) {
      if (tx) {
        await tx.rollback();
      }
      console.error('Erro ao enviar proposta assinada:', error);
      return res.status(500).json({ error: 'Falha ao enviar proposta assinada.' });
    } finally {
      tx?.release();
    }
  }

  async downloadDocument(req: AuthRequest, res: Response): Promise<Response> {
    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const role = String(req.userRole ?? '').trim().toLowerCase();
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return res.status(400).json({ error: 'ID de documento invalido.' });
    }

    try {
      const negotiationRows = await queryNegotiationRows<NegotiationAccessRow>(
        `
          SELECT id, capturing_broker_id, selling_broker_id, buyer_client_id
          FROM negotiations
          WHERE id = ?
          LIMIT 1
        `,
        [negotiationId]
      );
      const negotiation = negotiationRows[0];
      if (!negotiation) {
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      if (
        role !== 'admin' &&
        !canAccessNegotiationByOwnership(userId, negotiation)
      ) {
        return res.status(403).json({ error: 'Acesso negado ao documento.' });
      }

      const document = await findNegotiationDocumentById(documentId);
      if (!document) {
        return res.status(404).json({ error: 'Documento nao encontrado.' });
      }

      if (String(document.negotiationId) !== negotiationId) {
        return res.status(404).json({ error: 'Documento nao encontrado.' });
      }

      const contentType =
        document.type === 'proposal' || document.type === 'contract'
          ? 'application/pdf'
          : 'application/octet-stream';

      const metadata = parseJsonObjectSafe(document.metadataJson);
      const originalFileName = String(metadata.originalFileName ?? '').trim();
      const fallbackPrefix = String(document.documentType ?? document.type ?? 'documento')
        .trim()
        .toLowerCase();
      const extension = contentType === 'application/pdf' ? '.pdf' : '';
      const fallbackName = `${fallbackPrefix || 'documento'}_${documentId}${extension}`;
      const filename = originalFileName || fallbackName;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', buildAttachmentDisposition(filename));
      res.setHeader('Content-Length', document.fileContent.length.toString());

      res.end(document.fileContent);
      return res;
    } catch (error) {
      console.error('Erro ao baixar documento da negociacao:', error);
      return res.status(500).json({ error: 'Falha ao baixar documento.' });
    }
  }

  async downloadLatestProposal(req: AuthRequest, res: Response): Promise<Response> {
    const negotiationId = String(req.params.id ?? '').trim();
    if (!negotiationId) {
      return res.status(400).json({ error: 'ID de negociação inválido.' });
    }

    const userId = Number(req.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Usuário não autenticado.' });
    }

    const role = String(req.userRole ?? '').trim().toLowerCase();

    try {
      const negotiationRows = await queryNegotiationRows<NegotiationAccessRow>(
        `
          SELECT id, capturing_broker_id, selling_broker_id, buyer_client_id
          FROM negotiations
          WHERE id = ?
          LIMIT 1
        `,
        [negotiationId]
      );
      const negotiation = negotiationRows[0];
      if (!negotiation) {
        return res.status(404).json({ error: 'Negociação não encontrada.' });
      }

      if (
        role !== 'admin' &&
        !canAccessNegotiationByOwnership(userId, negotiation)
      ) {
        return res.status(403).json({ error: 'Acesso negado à proposta.' });
      }

      const document = await findLatestNegotiationDocumentByType(
        negotiationId,
        'proposal'
      );
      if (!document) {
        return res.status(404).json({ error: 'Nenhuma proposta encontrada para esta negociação.' });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="proposta.pdf"');
      res.setHeader('Content-Length', document.fileContent.length.toString());
      res.setHeader('X-Document-Id', String(document.id));

      res.end(document.fileContent);
      return res;
    } catch (error) {
      console.error('Erro ao baixar proposta da negociação:', error);
      return res.status(500).json({ error: 'Falha ao baixar proposta.' });
    }
  }
}

export const negotiationController = new NegotiationController();
