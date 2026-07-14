import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import connection from '../src/database/connection';

type CandidateRow = RowDataPacket & {
  negotiation_id: string;
  property_id: number;
  proposer_id: number | null;
  property_broker_id: number | null;
  property_owner_id: number | null;
  advertiser_id: number;
};

function readOption(name: string): string | null {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() || null : null;
}

function isApplyMode(): boolean {
  return process.argv.slice(2).includes('--apply');
}

async function findCandidates(propertyId: number | null): Promise<CandidateRow[]> {
  const propertyFilter = propertyId == null ? '' : 'AND n.property_id = ?';
  const params = propertyId == null ? [] : [propertyId];
  const [rows] = await connection.query<CandidateRow[]>(
    `
      SELECT
        n.id AS negotiation_id,
        n.property_id,
        n.proposer_id,
        p.broker_id AS property_broker_id,
        p.owner_id AS property_owner_id,
        COALESCE(p.broker_id, p.owner_id) AS advertiser_id
      FROM negotiations n
      JOIN properties p ON p.id = n.property_id
      JOIN users advertiser_user ON advertiser_user.id = COALESCE(p.broker_id, p.owner_id)
      WHERE n.advertiser_id IS NULL
        AND COALESCE(p.broker_id, p.owner_id) IS NOT NULL
        ${propertyFilter}
      ORDER BY n.created_at ASC, n.id ASC
    `,
    params,
  );
  return rows;
}

async function applyCandidate(candidate: CandidateRow): Promise<void> {
  const tx = await connection.getConnection();
  try {
    await tx.beginTransaction();
    const advertiserId = Number(candidate.advertiser_id);
    const proposerId = Number(candidate.proposer_id ?? 0);
    const ownerId = Number(candidate.property_owner_id ?? 0);
    const initiatorSide = proposerId > 0 && (proposerId === advertiserId || proposerId === ownerId)
      ? 'seller'
      : 'buyer';
    const [result] = await tx.query<ResultSetHeader>(
      `
        UPDATE negotiations
        SET advertiser_id = ?, initiator_side = ?, version = COALESCE(version, 0) + 1
        WHERE id = ?
          AND advertiser_id IS NULL
      `,
      [advertiserId, initiatorSide, candidate.negotiation_id],
    );
    if (result.affectedRows > 0) {
      await tx.query(
        `
          INSERT INTO negotiation_history (
            id, negotiation_id, from_status, to_status, actor_id, metadata_json, created_at
          )
          SELECT UUID(), id, status, status, NULL, CAST(? AS JSON), CURRENT_TIMESTAMP
          FROM negotiations
          WHERE id = ?
        `,
        [
          JSON.stringify({
            action: 'backfill_advertiser_from_property_relation',
            advertiserId,
            source: candidate.property_broker_id != null ? 'property_broker_id' : 'property_owner_id',
          }),
          candidate.negotiation_id,
        ],
      );
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.release();
  }
}

async function main(): Promise<void> {
  const rawPropertyId = readOption('property-id');
  let propertyId: number | null = null;
  if (rawPropertyId != null) {
    const parsedPropertyId = Number(rawPropertyId);
    if (!Number.isSafeInteger(parsedPropertyId) || parsedPropertyId <= 0) {
      throw new Error('--property-id deve ser um inteiro positivo.');
    }
    propertyId = parsedPropertyId;
  }

  const candidates = await findCandidates(propertyId);
  console.log(`Encontradas ${candidates.length} negociações sem anunciante vinculado.`);
  for (const candidate of candidates) {
    console.log(
      `negociação=${candidate.negotiation_id} imóvel=${candidate.property_id} anunciante=${candidate.advertiser_id}`
    );
  }
  if (!isApplyMode()) {
    console.log('Dry run concluído. Use --apply para persistir o saneamento.');
    return;
  }

  for (const candidate of candidates) {
    await applyCandidate(candidate);
  }
  console.log(`Saneamento concluído para ${candidates.length} negociações.`);
}

main()
  .catch((error) => {
    console.error('Falha ao sanear anunciantes de negociações:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await connection.end().catch(() => undefined);
  });
