import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import connection from '../src/database/connection';
import { buildBuyerLegalNameCorrection } from '../src/services/contractBuyerLegalNameAuditService';

type ContractAuditRow = RowDataPacket & {
  contract_id: string;
  buyer_info: unknown;
  workflow_metadata: unknown;
  proposal_buyer_name: string | null;
  proposer_name: string | null;
  legal_buyer_name: string | null;
};

type QueryExecutor = {
  query: (sql: string, values?: unknown) => Promise<[unknown, unknown]>;
};

function readLimit(): number {
  const argument = process.argv.slice(2).find((value) => value.startsWith('--limit='));
  const limit = Number(argument?.slice('--limit='.length) ?? 250);
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 5_000) {
    throw new Error('--limit deve ser um inteiro entre 1 e 5000.');
  }
  return limit;
}

function isApplyMode(): boolean {
  return process.argv.slice(2).includes('--apply');
}

async function loadRows(
  executor: QueryExecutor,
  contractId?: string,
  lockForUpdate = false,
): Promise<ContractAuditRow[]> {
  const contractFilter = contractId == null ? '' : 'AND c.id = ?';
  const params = contractId == null ? [readLimit()] : [contractId];
  const limitSql = contractId == null ? 'LIMIT ?' : '';
  const [rows] = await executor.query(
    `
      SELECT
        c.id AS contract_id,
        c.buyer_info,
        c.workflow_metadata,
        n.client_name AS proposal_buyer_name,
        proposer.name AS proposer_name,
        legal_buyer.name AS legal_buyer_name
      FROM contracts c
      JOIN negotiations n ON n.id = c.negotiation_id
      LEFT JOIN users proposer ON proposer.id = n.proposer_id
      LEFT JOIN users legal_buyer ON legal_buyer.id = n.legal_buyer_user_id
      WHERE JSON_UNQUOTE(JSON_EXTRACT(c.workflow_metadata, '$.partyResolution.buyer.nameSource'))
          IN ('proposer_profile', 'verified_email_profile')
        ${contractFilter}
      ORDER BY c.created_at ASC, c.id ASC
      ${limitSql}
      ${lockForUpdate ? 'FOR UPDATE' : ''}
    `,
    params,
  );
  return rows as ContractAuditRow[];
}

function correctionFor(row: ContractAuditRow) {
  const metadata = typeof row.workflow_metadata === 'string'
    ? JSON.parse(row.workflow_metadata)
    : row.workflow_metadata;
  const buyerSource = String(
    (metadata as { partyResolution?: { buyer?: { nameSource?: unknown } } })?.partyResolution?.buyer?.nameSource ?? '',
  );
  const profileBuyerName = buyerSource === 'verified_email_profile'
    ? row.legal_buyer_name
    : row.proposer_name;
  return buildBuyerLegalNameCorrection({
    buyerInfo: row.buyer_info,
    workflowMetadata: row.workflow_metadata,
    proposalBuyerName: row.proposal_buyer_name,
    profileBuyerName,
  });
}

async function applyCorrection(contractId: string): Promise<'updated' | 'skipped'> {
  const tx = await connection.getConnection();
  try {
    await tx.beginTransaction();
    const rows = await loadRows(tx as unknown as QueryExecutor, contractId, true);
    const correction = rows.length === 1 ? correctionFor(rows[0]) : null;
    if (correction == null) {
      await tx.commit();
      return 'skipped';
    }
    await tx.query<ResultSetHeader>(
      `
        UPDATE contracts
        SET buyer_info = CAST(? AS JSON), workflow_metadata = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [JSON.stringify(correction.buyerInfo), JSON.stringify(correction.workflowMetadata), contractId],
    );
    await tx.commit();
    return 'updated';
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

async function main(): Promise<void> {
  const rows = await loadRows(connection as unknown as QueryExecutor);
  const candidates = rows
    .map((row) => ({ row, correction: correctionFor(row) }))
    .filter((candidate) => candidate.correction != null);

  console.log(`Auditoria encontrou ${candidates.length} correção(ões) segura(s).`);
  console.table(candidates.map(({ row, correction }) => ({
    contractId: row.contract_id,
    previousName: correction!.previousName,
    legalName: correction!.legalName,
  })));

  if (!isApplyMode()) {
    console.log('Dry run concluído. Nenhum dado foi alterado. Use --apply para persistir as correções listadas.');
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    if (await applyCorrection(candidate.row.contract_id) === 'updated') updated += 1;
    else skipped += 1;
  }
  console.log(`Saneamento concluído: ${updated} atualizado(s), ${skipped} ignorado(s) por alteração concorrente.`);
}

main()
  .catch((error) => {
    console.error('Falha na auditoria de nomes jurídicos do comprador:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end().catch(() => undefined);
  });
