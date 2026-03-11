import { PoolConnection, RowDataPacket } from 'mysql2/promise';

import connection from '../database/connection';
import type { ProposalData } from '../modules/negotiations/domain/states/NegotiationState';
import { ExternalPdfService } from '../modules/negotiations/infra/ExternalPdfService';
import { NegotiationDocumentsRepository } from '../modules/negotiations/infra/NegotiationDocumentsRepository';
import type { SqlExecutor } from '../modules/negotiations/infra/NegotiationRepository';

const executor: SqlExecutor = {
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<T | [T, unknown]> {
    return connection.execute(sql, params as any) as unknown as Promise<T | [T, unknown]>;
  },
};

const pdfService = new ExternalPdfService();
const negotiationDocumentsRepository = new NegotiationDocumentsRepository(executor);

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
