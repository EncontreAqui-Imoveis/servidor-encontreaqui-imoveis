import type { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';

import { resolveContractStatus, type ContractRow } from '../controllers/ContractController';

export interface ContractFinalizedDocumentRow extends RowDataPacket {
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

class ContractFinalizedDeletionError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function mutationError(statusCode: number, message: string): ContractFinalizedDeletionError {
  return new ContractFinalizedDeletionError(statusCode, message);
}

function buildContractDocumentDeleteWhereClause(): string {
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
  contract: Pick<ContractRow, 'id' | 'negotiation_id'>
): Promise<ContractFinalizedDocumentRow[]> {
  const [rows] = await tx.query<ContractFinalizedDocumentRow[]>(
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
      WHERE ${buildContractDocumentDeleteWhereClause()}
      ORDER BY id DESC
    `,
    [contract.negotiation_id, contract.id]
  );

  return rows;
}

export async function deleteFinalizedContract(
  tx: PoolConnection,
  params: {
    contractId: string;
  }
): Promise<{
  contract: ContractRow;
  documents: ContractFinalizedDocumentRow[];
}> {
  const [contractRows] = await tx.query<ContractRow[]>(
    `
      SELECT *
      FROM contracts
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
    `,
    [params.contractId]
  );

  const contract = contractRows[0];
  if (!contract) {
    throw mutationError(404, 'Contrato não encontrado.');
  }

  if (resolveContractStatus(contract.status) !== 'FINALIZED') {
    throw mutationError(400, 'Somente contratos finalizados podem ser excluídos nesta área.');
  }

  const documents = await fetchDocumentsForContractScope(tx, contract);

  if (documents.length > 0) {
    await tx.query(
      `
        DELETE FROM negotiation_documents
        WHERE ${buildContractDocumentDeleteWhereClause()}
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
    [params.contractId]
  );

  return { contract, documents };
}

export function isContractFinalizedDeletionError(
  error: unknown
): error is ContractFinalizedDeletionError {
  return error instanceof ContractFinalizedDeletionError;
}
