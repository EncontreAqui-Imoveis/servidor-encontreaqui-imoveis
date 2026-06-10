import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import connection from '../database/connection';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import { ExternalPdfService } from '../modules/negotiations/infra/ExternalPdfService';
import { NegotiationDocumentsRepository } from '../modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../modules/negotiations/infra/NegotiationRepository';
import { resolvePropertyAddress } from './negotiationProposalSupportService';

const executor: SqlExecutor = {
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<T | [T, unknown]> {
    return connection.execute(sql, params as any) as unknown as Promise<T | [T, unknown]>;
  },
};

const pdfService = new ExternalPdfService();
const negotiationDocumentsRepository = new NegotiationDocumentsRepository(executor);

interface NegotiationProposalRow extends RowDataPacket {
  negotiation_id: string;
  client_name: string | null;
  client_cpf: string | null;
  payment_details: unknown;
  final_value: number | string | null;
  validity_days: number | string | null;
  address: string | null;
  numero: string | null;
  quadra: string | null;
  lote: string | null;
  bairro: string | null;
  city: string | null;
  state: string | null;
  capturing_broker_name: string | null;
  selling_broker_name: string | null;
}

function parseJsonObjectSafe(value: unknown): Record<string, unknown> {
  if (!value) return {};
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

function readPaymentAmount(
  paymentDetails: Record<string, unknown>,
  keys: string[]
): number {
  for (const key of keys) {
    const direct = paymentDetails[key];
    const details = paymentDetails.details as Record<string, unknown> | undefined;
    const nested = details?.[key];
    const payment = paymentDetails[`payment${key[0].toUpperCase()}${key.slice(1)}`];

    for (const value of [direct, nested, payment]) {
      if (value === undefined || value === null || String(value).trim() === '') {
        continue;
      }
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

export async function queryNegotiationRows<T extends RowDataPacket>(
  sql: string,
  params: unknown[]
): Promise<T[]> {
  const [rows] = await connection.query<T[]>(sql, params as any);
  return rows;
}

export async function executeNegotiationStatement(
  sql: string,
  params: unknown[]
): Promise<void> {
  await connection.execute(sql, params as any);
}

export function getNegotiationDbConnection(): Promise<PoolConnection> {
  return connection.getConnection();
}

export function generateNegotiationProposalPdf(proposalData: ProposalData): Promise<Buffer> {
  return pdfService.generateProposal(proposalData);
}

export async function getNegotiationProposalDataById(negotiationId: string): Promise<ProposalData> {
  const [rows] = await connection.query<NegotiationProposalRow[]>(
    `
      SELECT
        n.id AS negotiation_id,
        n.client_name,
        n.client_cpf,
        n.payment_details,
        n.final_value,
        n.proposal_validity_date,
        p.address,
        p.numero,
        p.quadra,
        p.lote,
        p.bairro,
        p.city,
        p.state,
        cb.name AS capturing_broker_name,
        sb.name AS selling_broker_name
      FROM negotiations n
      INNER JOIN properties p ON p.id = n.property_id
      LEFT JOIN users cb ON cb.id = n.capturing_broker_id
      LEFT JOIN users sb ON sb.id = n.selling_broker_id
      WHERE n.id = ?
      LIMIT 1
    `,
    [negotiationId]
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Negotiation not found for proposal generation.');
  }

  const paymentDetails = parseJsonObjectSafe(row.payment_details);
  const details = parseJsonObjectSafe(paymentDetails.details);
  const finalValue = Number(row.final_value ?? paymentDetails.amount ?? 0);
  const validityDays = Number(paymentDetails.validadeDias ?? paymentDetails.validityDays ?? 10);
  const payment = {
    cash: readPaymentAmount(paymentDetails, ['dinheiro', 'cash', 'paymentDinheiro']),
    tradeIn: readPaymentAmount(paymentDetails, ['permuta', 'tradeIn', 'paymentPermuta']),
    financing: readPaymentAmount(paymentDetails, ['financiamento', 'financing', 'paymentFinanciamento']),
    others: readPaymentAmount(paymentDetails, ['outros', 'others', 'paymentOutros']),
  };

  const resolvedPayment = {
    cash: payment.cash,
    tradeIn: payment.tradeIn,
    financing: payment.financing,
    others: payment.others,
  };
  const paymentTotal = resolvedPayment.cash + resolvedPayment.tradeIn + resolvedPayment.financing + resolvedPayment.others;
  const normalizedFinalValue = Number.isFinite(finalValue) && finalValue > 0
    ? finalValue
    : paymentTotal;
  const fallbackPropertyAddress = resolvePropertyAddress({
    address: row.address,
    numero: row.numero,
    quadra: row.quadra,
    lote: row.lote,
    bairro: row.bairro,
    city: row.city,
    state: row.state,
  });

  return {
    clientName: String(row.client_name ?? details.clientName ?? details.client_name ?? '').trim(),
    clientCpf: String(row.client_cpf ?? details.clientCpf ?? details.client_cpf ?? '').trim(),
    propertyAddress: fallbackPropertyAddress,
    brokerName: String(row.capturing_broker_name ?? '').trim(),
    sellingBrokerName: String(row.selling_broker_name ?? '').trim() || null,
    value: normalizedFinalValue,
    payment: resolvedPayment,
    paymentMethod: String(paymentDetails.paymentMethod ?? paymentDetails.payment_method ?? '').trim() || undefined,
    validityDays: Number.isInteger(validityDays) && validityDays > 0 ? validityDays : 10,
  };
}

export function saveNegotiationProposalDocument(
  negotiationId: string,
  pdfBuffer: Buffer,
  trx?: PoolConnection | null,
  metadataJson?: Record<string, unknown> | null
): Promise<number> {
  return negotiationDocumentsRepository.saveProposal(
    negotiationId,
    pdfBuffer,
    trx ? (trx as unknown as SqlExecutor) : undefined,
    metadataJson
  );
}

export function saveNegotiationSignedProposalDocument(
  negotiationId: string,
  pdfBuffer: Buffer,
  trx?: PoolConnection | null,
  metadataJson?: Record<string, unknown> | null
): Promise<number> {
  return negotiationDocumentsRepository.saveSignedProposal(
    negotiationId,
    pdfBuffer,
    trx ? (trx as unknown as SqlExecutor) : undefined,
    metadataJson
  );
}

export function findNegotiationDocumentById(documentId: number, trx?: PoolConnection | null) {
  return negotiationDocumentsRepository.findById(
    documentId,
    trx ? (trx as unknown as SqlExecutor) : undefined
  );
}

export function findLatestNegotiationDocumentByType(
  negotiationId: string,
  type: 'proposal' | 'contract' | 'other',
  trx?: PoolConnection | null
) {
  return negotiationDocumentsRepository.findLatestByNegotiationAndType(
    negotiationId,
    type,
    trx ? (trx as unknown as SqlExecutor) : undefined
  );
}
