import type { ResultSetHeader, RowDataPacket, PoolConnection } from 'mysql2/promise';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import connection from '../src/database/connection';
import { enqueueNegotiationDocumentDeletion } from '../src/services/negotiationDocumentDeletionService';

const RESETTABLE_NEGOTIATION_STATUSES = [
  'PROPOSAL_DRAFT',
  'PROPOSAL_SENT',
  'PROPOSAL_SIGNED',
  'PROPOSAL_UNSIGNED',
  'IN_NEGOTIATION',
  'DOCUMENTATION_PHASE',
  'CONTRACT_DRAFTING',
  'CONTRACT_PREPARATION',
  'AWAITING_DOCS',
  'AWAITING_SIGNATURES',
  'IN_DRAFT',
  'FINALIZED',
  'APPROVED',
  'CONCLUDED',
] as const;

type ContractPurgeRow = RowDataPacket & {
  id: string | null;
  negotiation_id: string;
  property_id: string;
  status: string | null;
  negotiation_status: string | null;
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

function isDryRun(argv: string[]): boolean {
  return argv.some((value) => value === '--dry-run');
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

async function requireInteractiveConfirmation(targetDatabase: string, totalTargets: number): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error('Purge bloqueado: confirmação interativa requerida.');
  }

  const rl = readline.createInterface({ input, output });
  try {
    const expected = `PURGE ${targetDatabase} ${totalTargets}`;
    const answer = await rl.question(
      `Digite exatamente "${expected}" para confirmar a exclusão de ${totalTargets} alvos (contratos/negociações) no banco ${targetDatabase}: `
    );

    if (answer.trim() !== expected) {
      throw new Error('Confirmação inválida. Purge cancelado.');
    }
  } finally {
    rl.close();
  }
}

async function fetchPurgeTargets(): Promise<ContractPurgeRow[]> {
  const placeholders = RESETTABLE_NEGOTIATION_STATUSES.map(() => '?').join(', ');
  const [rows] = await connection.query<ContractPurgeRow[]>(
    `
      SELECT
        c.id,
        n.id AS negotiation_id,
        n.property_id,
        c.status,
        n.status AS negotiation_status
      FROM negotiations n
      LEFT JOIN contracts c ON c.negotiation_id = n.id
      WHERE UPPER(TRIM(COALESCE(n.status, ''))) IN (${placeholders})
      ORDER BY n.id ASC, c.id ASC
    `,
    [...RESETTABLE_NEGOTIATION_STATUSES]
  );
  return rows;
}

async function fetchDocumentsForContract(
  tx: PoolConnection,
  contract: ContractPurgeRow
): Promise<ContractDocumentRow[]> {
  if (!contract.id) return [];

  const [rows] = await tx.query<ContractDocumentRow[]>(
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
  deletedContract: boolean;
  cancelledNegotiation: boolean;
}> {
  const tx = await connection.getConnection();
  try {
    await tx.beginTransaction();

    const documents = await fetchDocumentsForContract(tx, contract);

    for (const document of documents) {
      await enqueueNegotiationDocumentDeletion(tx, document, {
        negotiationId: contract.negotiation_id,
        requestSource: 'purge_contracts_script',
      });
    }

    if (documents.length > 0 && contract.id) {
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

    const [negotiationResult] = await tx.query<ResultSetHeader>(
      `
        UPDATE negotiations
        SET status = 'CANCELLED', version = version + 1
        WHERE id = ?
          AND UPPER(TRIM(COALESCE(status, ''))) NOT IN
            ('CANCELLED', 'REJECTED', 'REFUSED', 'EXPIRED', 'SOLD', 'RENTED')
      `,
      [contract.negotiation_id]
    );

    if (negotiationResult.affectedRows > 0) {
      await tx.query(
        `
          INSERT INTO negotiation_history (
            id,
            negotiation_id,
            from_status,
            to_status,
            actor_id,
            metadata_json,
            created_at
          ) VALUES (UUID(), ?, ?, 'CANCELLED', NULL, CAST(? AS JSON), CURRENT_TIMESTAMP)
        `,
        [
          contract.negotiation_id,
          contract.negotiation_status,
          JSON.stringify({ action: 'maintenance_contract_purge' }),
        ]
      );
    }

    await tx.query(
      `
        UPDATE properties
        SET
          lifecycle_status = 'AVAILABLE',
          status = 'approved',
          visibility = 'PUBLIC',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND UPPER(TRIM(COALESCE(lifecycle_status, ''))) NOT IN ('SOLD', 'RENTED')
          AND LOWER(TRIM(COALESCE(status, ''))) NOT IN ('sold', 'rented')
      `,
      [contract.property_id]
    );

    let deletedContract = false;
    if (contract.id) {
      const [contractResult] = await tx.query<ResultSetHeader>(
        `
          DELETE FROM contracts
          WHERE id = ?
          LIMIT 1
        `,
        [contract.id]
      );
      deletedContract = contractResult.affectedRows > 0;
    }

    await tx.commit();
    return {
      deletedDocuments: documents.length,
      deletedContract,
      cancelledNegotiation: negotiationResult.affectedRows > 0,
    };
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = isDryRun(argv);

  if (!dryRun) requireMaintenanceMode();

  if (!dryRun && !isConfirmFlagEnabled(argv)) {
    console.error('Use --confirm para executar o purge de contratos.');
    process.exit(1);
  }

  const targetDatabase = await fetchDatabaseName();
  const targets = await fetchPurgeTargets();
  console.log(`Encontrados ${targets.length} alvos para saneamento.`);
  console.log(`Banco alvo: ${targetDatabase}`);

  if (dryRun) {
    for (const target of targets) {
      console.log(
        `[DRY-RUN] negociação=${target.negotiation_id} contrato=${target.id ?? 'nenhum'} ` +
          `imovel=${target.property_id} status_negociacao=${target.negotiation_status ?? 'n/a'}`
      );
    }
    return;
  }

  await requireInteractiveConfirmation(targetDatabase, targets.length);

  let totalDocuments = 0;
  let totalContracts = 0;
  let totalNegotiations = 0;

  for (const contract of targets) {
    const result = await purgeSingleContract(contract);
    totalDocuments += result.deletedDocuments;
    if (result.deletedContract) totalContracts += 1;
    if (result.cancelledNegotiation) totalNegotiations += 1;
    console.log(
      `Negociação ${contract.negotiation_id} saneada. ` +
        `Contrato: ${contract.id ?? 'nenhum'}. ` +
        `Status original: ${contract.negotiation_status ?? contract.status ?? 'n/a'}. ` +
        `Documentos enfileirados/excluídos: ${result.deletedDocuments}.`
    );
  }

  console.log(
    `Purge concluído. Contratos removidos: ${totalContracts}. ` +
      `Negociações canceladas: ${totalNegotiations}. ` +
      `Documentos processados: ${totalDocuments}.`
  );
}

main()
  .catch((error) => {
    console.error('Falha ao executar purge de contratos:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end().catch(() => undefined);
  });
