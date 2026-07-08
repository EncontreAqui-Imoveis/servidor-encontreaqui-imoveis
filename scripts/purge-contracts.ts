import type { RowDataPacket } from 'mysql2/promise';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import connection from '../src/database/connection';
import { enqueueNegotiationDocumentDeletion } from '../src/services/negotiationDocumentDeletionService';
import { markContractPropertyAvailable } from '../src/services/contractFinalizedDeletionService';

type ContractPurgeRow = RowDataPacket & {
  id: string;
  negotiation_id: string;
  property_id: string;
  status: string;
};

type ContractDocumentRow = RowDataPacket & {
  id: number;
  type: string | null;
  document_type: string | null;
  metadata_json: unknown;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
};

function isConfirmFlagEnabled(argv: string[]): boolean {
  return argv.some((value) => value === '--confirm' || value === '--yes');
}

function requireMaintenanceMode(): void {
  const nodeEnv = String(process.env.NODE_ENV ?? '').trim().toLowerCase();
  const enabled = String(process.env.PURGE_CONTRACTS_ENABLED ?? '').trim().toLowerCase();

  if (nodeEnv !== 'maintenance' || enabled !== 'true') {
    throw new Error(
      'Purge bloqueado: defina NODE_ENV=maintenance e PURGE_CONTRACTS_ENABLED=true para habilitar.'
    );
  }
}

async function fetchDatabaseName(): Promise<string> {
  const [rows] = await connection.query<RowDataPacket[]>(`
    SELECT DATABASE() AS database_name
  `);

  const databaseName = String(rows[0]?.database_name ?? '').trim();
  if (!databaseName) {
    throw new Error('Não foi possível identificar o banco atual.');
  }

  return databaseName;
}

async function requireInteractiveConfirmation(targetDatabase: string, totalContracts: number): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error('Purge bloqueado: confirmação interativa requerida.');
  }

  const rl = readline.createInterface({ input, output });
  try {
    const expected = `PURGE ${targetDatabase} ${totalContracts}`;
    const answer = await rl.question(
      `Digite exatamente "${expected}" para confirmar a exclusão definitiva de ${totalContracts} contratos no banco ${targetDatabase}: `
    );

    if (answer.trim() !== expected) {
      throw new Error('Confirmação inválida. Purge cancelado.');
    }
  } finally {
    rl.close();
  }
}

async function fetchAllContracts(): Promise<ContractPurgeRow[]> {
  const [rows] = await connection.query<ContractPurgeRow[]>(
    `
      SELECT id, negotiation_id, property_id, status
      FROM contracts
      ORDER BY id ASC
    `
  );
  return rows;
}

async function fetchDocumentsForContract(contract: ContractPurgeRow): Promise<ContractDocumentRow[]> {
  const [rows] = await connection.query<ContractDocumentRow[]>(
    `
      SELECT
        id,
        type,
        document_type,
        metadata_json,
        storage_provider,
        storage_bucket,
        storage_key
      FROM negotiation_documents
      WHERE negotiation_id = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
          OR JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
        )
        AND COALESCE(document_type, '') <> 'proposal'
        AND COALESCE(type, '') <> 'proposal'
      ORDER BY id DESC
    `,
    [contract.negotiation_id, contract.id]
  );

  return rows;
}

async function purgeSingleContract(contract: ContractPurgeRow): Promise<{
  deletedDocuments: number;
}> {
  const tx = await connection.getConnection();
  try {
    await tx.beginTransaction();

    const documents = await fetchDocumentsForContract(contract);

    for (const document of documents) {
      await enqueueNegotiationDocumentDeletion(tx, document, {
        negotiationId: contract.negotiation_id,
        requestSource: 'purge_contracts_script',
      });
    }

    if (documents.length > 0) {
      await tx.query(
        `
          DELETE FROM negotiation_documents
          WHERE negotiation_id = ?
            AND (
              JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.contractId')) = ?
              OR JSON_EXTRACT(metadata_json, '$.contractId') IS NULL
            )
            AND COALESCE(document_type, '') <> 'proposal'
            AND COALESCE(type, '') <> 'proposal'
        `,
        [contract.negotiation_id, contract.id]
      );
    }

    await markContractPropertyAvailable(tx, contract.property_id);

    await tx.query(
      `
        DELETE FROM contracts
        WHERE id = ?
        LIMIT 1
      `,
      [contract.id]
    );

    await tx.commit();
    return { deletedDocuments: documents.length };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

async function main() {
  requireMaintenanceMode();

  if (!isConfirmFlagEnabled(process.argv.slice(2))) {
    console.error('Use --confirm para executar o purge de contratos.');
    process.exit(1);
  }

  const targetDatabase = await fetchDatabaseName();
  const contracts = await fetchAllContracts();
  console.log(`Encontrados ${contracts.length} contratos para purgar.`);
  console.log(`Banco alvo: ${targetDatabase}`);

  await requireInteractiveConfirmation(targetDatabase, contracts.length);

  let totalDocuments = 0;
  let totalContracts = 0;

  for (const contract of contracts) {
    const result = await purgeSingleContract(contract);
    totalDocuments += result.deletedDocuments;
    totalContracts += 1;
    console.log(
      `Contrato ${contract.id} purgado. Status original: ${contract.status}. Documentos enfileirados/excluídos: ${result.deletedDocuments}.`
    );
  }

  console.log(`Purge concluído. Contratos removidos: ${totalContracts}. Documentos processados: ${totalDocuments}.`);
}

main()
  .catch((error) => {
    console.error('Falha ao executar purge de contratos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end().catch(() => undefined);
  });
